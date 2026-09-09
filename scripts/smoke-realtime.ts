// Standalone smoke test for either realtime provider — connects, opens
// the WebSocket from Node (no Electron, no audio), runs a text round-trip and a
// tool-call round-trip, and prints the streamed transcript.
// Usage: `pnpm smoke:realtime [model-id] [--openai]` (default: gateway, openai/gpt-realtime-2)
import { config as loadEnv } from "dotenv";
import { connectRealtime } from "../src/main/agent/realtime/connection";
import { z } from "zod";

loadEnv({ quiet: true });

const provider = process.argv.includes("--openai") ? "openai" : "gateway";
const modelId = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "openai/gpt-realtime-2";
const TIMEOUT_MS = 60_000;

// Mirrors how realtime-tools.ts will flatten a skill tool for the session.
const weatherTool = {
  type: "function" as const,
  name: "getWeather",
  description: "Get the current weather for a location.",
  parameters: z.toJSONSchema(
    z.object({ location: z.string().describe("City name") }),
  ) as never,
};

async function main() {
  console.log(`[smoke] provider=${provider} model=${modelId}`);
  const { codec: model, ws } = await connectRealtime(provider, modelId);

  const send = async (event: Parameters<typeof model.serializeClientEvent>[0]) =>
    ws.send(JSON.stringify(await model.serializeClientEvent(event)));

  let phase: "text" | "tool" | "tool-result" = "text";
  let transcriptChars = 0;
  let audioBytes = 0;
  let sawToolCall = false;
  let sawToolSummary = false;

  const timeout = setTimeout(() => {
    console.error(`\n[smoke] FAIL: timed out in phase=${phase}`);
    process.exit(1);
  }, TIMEOUT_MS);

  ws.addEventListener("open", async () => {
    console.log("[smoke] ws open");
    await send({
      type: "session-update",
      config: {
        instructions:
          "You are a terse test assistant. Answer in one short sentence. " +
          "Use the getWeather tool when asked about weather.",
        turnDetection: { type: "disabled" },
        outputAudioFormat: { type: "audio/pcm", rate: 24000 },
        tools: [weatherTool],
      },
    });
    await send({
      type: "conversation-item-create",
      item: { type: "text-message", role: "user", text: "Say hello in one sentence." },
    });
    await send({ type: "response-create" });
  });

  ws.addEventListener("message", async (msg: { data: unknown }) => {
    const raw = JSON.parse(String(msg.data));
    const keepalive = model.getHealthCheckResponse?.(raw);
    if (keepalive) {
      ws.send(JSON.stringify(keepalive));
      return;
    }
    const parsed = model.parseServerEvent(raw);
    for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
      switch (event.type) {
        case "audio-transcript-delta":
        case "text-delta":
          process.stdout.write(event.delta);
          transcriptChars += event.delta.length;
          if (phase === "tool-result") sawToolSummary = true;
          break;
        case "audio-delta":
          audioBytes += Buffer.from(event.delta, "base64").length;
          break;
        case "function-call-arguments-done": {
          sawToolCall = true;
          console.log(`\n[smoke] tool call: ${event.name}(${event.arguments})`);
          phase = "tool-result";
          await send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId: event.callId,
              name: event.name,
              output: JSON.stringify({ temperature: "21C", condition: "sunny" }),
            },
          });
          await send({ type: "response-create" });
          break;
        }
        case "response-done":
          if (phase === "text") {
            console.log(`\n[smoke] text turn done (${transcriptChars} transcript chars, ${audioBytes} audio bytes)`);
            phase = "tool";
            await send({
              type: "conversation-item-create",
              item: { type: "text-message", role: "user", text: "What's the weather in Paris?" },
            });
            await send({ type: "response-create" });
          } else if (phase === "tool-result" && sawToolSummary) {
            clearTimeout(timeout);
            console.log(`\n[smoke] PASS: tool round-trip complete (${audioBytes} total audio bytes)`);
            ws.close();
            process.exit(0);
          }
          // phase === "tool" with no tool call yet: the response-done for the
          // function-call arguments item; wait for function-call-arguments-done.
          if (phase === "tool" && !sawToolCall) {
            console.log("\n[smoke] WARN: response done in tool phase without a tool call");
          }
          break;
        case "error":
          console.error(`\n[smoke] FAIL: server error: ${event.message} (${event.code ?? "no code"})`);
          process.exit(1);
      }
    }
  });

  ws.addEventListener("close", (e: { code: number }) => {
    console.log(`[smoke] ws closed code=${e.code}`);
    clearTimeout(timeout);
    process.exit(1);
  });
  ws.addEventListener("error", () => {
    console.error("[smoke] FAIL: ws error");
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("[smoke] error", err instanceof Error ? err.message : "Connection failed");
  process.exit(1);
});
