// Hosts a realtime speech-to-speech session in MAIN: owns the WebSocket (the
// gateway authenticates the upgrade with the raw AI_GATEWAY_API_KEY — no
// ephemeral secret exists, so the socket can never live in the renderer),
// executes direct tool calls next to it, and relays audio/transcripts/notices
// to the renderer over IPC. The renderer owns only mic capture + playback.
//
// Provider seam: everything wire-specific goes through the AI SDK's
// RealtimeModelV4 codec surface (getWebSocketConfig / serializeClientEvent /
// parseServerEvent / getHealthCheckResponse). For the gateway these are
// pass-throughs — the gateway server speaks the normalized event format — but
// coding against the codec keeps a future direct-OpenAI model a drop-in.
import { gateway } from "@ai-sdk/gateway";
import type { ToolSet } from "ai";
import { mintRealtimeToken } from "./gateway-token";
import type { RealtimeToolDef } from "./realtime-tools";
import {
  RUN_TASK_TOOL,
  type RealtimeClientMessage,
  type RealtimeServerNotice,
} from "../../ipc/channels";

type RealtimeCodec = ReturnType<typeof gateway.experimental_realtime>;
type RealtimeClientEvent = Parameters<RealtimeCodec["serializeClientEvent"]>[0];

export interface RealtimeSessionOptions {
  /** Caller-minted session id (also names the IPC event channel, so the
   *  renderer can subscribe before the first notice fires). */
  sessionId: string;
  /** Gateway slash-form model id. */
  model: string;
  /** Voice id, or empty for the model's default. */
  voice: string;
  instructions: string;
  /** Tools declared to the session (direct skill tools + run_task). */
  toolDefs: RealtimeToolDef[];
  /** Executable direct tools, already permission-wrapped by buildToolSet. */
  tools: ToolSet;
  /** Whether the model transcribes the user's speech (user-transcript notices). */
  transcribesInput: boolean;
  /** Deliver a notice to the renderer (bound to the session's IPC channel). */
  notify: (notice: RealtimeServerNotice) => void;
}

interface SessionHost {
  ws: WebSocket;
  codec: RealtimeCodec;
  tools: ToolSet;
  notify: (notice: RealtimeServerNotice) => void;
  /** Set when we closed deliberately, so the close handler reports "ended". */
  endedByUs: boolean;
  /** The current turn saw a WS-level error (reported as reason "error"). */
  sawSocketError: boolean;
}

const sessions = new Map<string, SessionHost>();

/** Open a realtime session. Resolves once the socket is connected and
 *  configured (rejects if the connection fails outright). */
export async function startRealtimeSession(
  opts: RealtimeSessionOptions,
): Promise<void> {
  const { token, url } = await mintRealtimeToken(opts.model);
  const codec = gateway.experimental_realtime(opts.model);
  const wsConfig = codec.getWebSocketConfig({ token, url });
  const ws = new WebSocket(wsConfig.url, wsConfig.protocols);

  const { sessionId } = opts;
  const host: SessionHost = {
    ws,
    codec,
    tools: opts.tools,
    notify: opts.notify,
    endedByUs: false,
    sawSocketError: false,
  };
  sessions.set(sessionId, host);

  const send = async (event: RealtimeClientEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(await codec.serializeClientEvent(event)));
  };

  ws.addEventListener("message", (msg) => {
    void handleServerMessage(host, send, String(msg.data));
  });
  ws.addEventListener("error", () => {
    host.sawSocketError = true;
  });
  ws.addEventListener("close", () => {
    sessions.delete(sessionId);
    host.notify({
      type: "closed",
      reason: host.endedByUs ? "ended" : host.sawSocketError ? "error" : "server",
    });
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "close",
      () => reject(new Error("Realtime connection failed — please try again.")),
      { once: true },
    );
  });

  await send({
    type: "session-update",
    config: {
      instructions: opts.instructions,
      ...(opts.voice ? { voice: opts.voice } : {}),
      turnDetection: { type: "server-vad" },
      inputAudioFormat: { type: "audio/pcm", rate: 24000 },
      outputAudioFormat: { type: "audio/pcm", rate: 24000 },
      // Opt into user-speech transcription where the model supports it, so the
      // transcript UI gets the user's turns (final text, no deltas).
      ...(opts.transcribesInput ? { inputAudioTranscription: {} } : {}),
      tools: opts.toolDefs.map((d) => ({
        type: "function" as const,
        name: d.name,
        description: d.description,
        parameters: d.parameters as never,
      })),
    },
  });

  opts.notify({ type: "open" });
}

/** Relay one renderer message into the session (no-op once the session died). */
export function sendRealtimeClientMessage(
  sessionId: string,
  msg: RealtimeClientMessage,
): void {
  const host = sessions.get(sessionId);
  if (!host) return;
  const send = async (event: RealtimeClientEvent) => {
    if (host.ws.readyState !== WebSocket.OPEN) return;
    host.ws.send(JSON.stringify(await host.codec.serializeClientEvent(event)));
  };

  switch (msg.type) {
    case "audio":
      void send({
        type: "input-audio-append",
        audio: Buffer.from(msg.chunk).toString("base64"),
      });
      break;
    case "user-text":
      void (async () => {
        await send({
          type: "conversation-item-create",
          item: { type: "text-message", role: "user", text: msg.text },
        });
        await send({ type: "response-create" });
      })();
      break;
    case "inject-context":
      void send({
        type: "conversation-item-create",
        item: { type: "text-message", role: "user", text: msg.text },
      });
      break;
    case "request-response":
      void send({ type: "response-create" });
      break;
    case "tool-result":
      void (async () => {
        await send({
          type: "conversation-item-create",
          item: {
            type: "function-call-output",
            callId: msg.toolCallId,
            name: msg.name,
            output: JSON.stringify(msg.output ?? null),
          },
        });
        await send({ type: "response-create" });
      })();
      break;
    case "cancel-response":
      void send({ type: "response-cancel" });
      break;
  }
}

/** Close a session deliberately (idle disconnect, mute, mode switch, window
 *  death). Safe to call twice. */
export function endRealtimeSession(sessionId: string): void {
  const host = sessions.get(sessionId);
  if (!host) return;
  host.endedByUs = true;
  try {
    host.ws.close();
  } catch {
    // already closing
  }
}

async function handleServerMessage(
  host: SessionHost,
  send: (event: RealtimeClientEvent) => Promise<void>,
  data: string,
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return;
  }
  // Provider keepalive (ping/pong style) — answer before parsing.
  const keepalive = host.codec.getHealthCheckResponse?.(raw);
  if (keepalive) {
    host.ws.send(JSON.stringify(keepalive));
    return;
  }

  const parsed = host.codec.parseServerEvent(raw);
  for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
    switch (event.type) {
      case "speech-started":
        host.notify({ type: "speech-started" });
        break;
      case "speech-stopped":
        // The renderer's idle window must not count while the user is
        // mid-sentence — it needs the end-of-speech signal too.
        host.notify({ type: "speech-stopped" });
        break;
      case "input-transcription-completed":
        if (event.transcript.trim()) {
          host.notify({ type: "user-transcript", text: event.transcript });
        }
        break;
      case "audio-delta": {
        const buf = Buffer.from(event.delta, "base64");
        host.notify({
          type: "audio",
          chunk: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        });
        break;
      }
      case "audio-transcript-delta":
      case "text-delta":
        host.notify({ type: "assistant-delta", text: event.delta });
        break;
      case "response-done":
        host.notify({ type: "turn-done" });
        break;
      case "function-call-arguments-done": {
        let input: unknown = {};
        try {
          input = JSON.parse(event.arguments || "{}");
        } catch {
          // leave as {}
        }
        const call = { toolCallId: event.callId, toolName: event.name, input };
        host.notify({ type: "tool-call", call });
        if (event.name === RUN_TASK_TOOL) {
          // Delegated: the renderer drives the pipeline command and answers
          // with a `tool-result` client message.
          const task =
            typeof (input as { task?: unknown }).task === "string"
              ? (input as { task: string }).task
              : "";
          host.notify({ type: "run-task", toolCallId: event.callId, task });
          break;
        }
        // Direct tool: execute here (permission gate is baked into the set).
        void (async () => {
          let output: unknown;
          try {
            const toolFn = host.tools[event.name];
            output = toolFn?.execute
              ? await toolFn.execute(input as never, {
                  toolCallId: event.callId,
                  messages: [],
                })
              : { error: `Unknown tool: ${event.name}` };
          } catch (err) {
            output = { error: err instanceof Error ? err.message : String(err) };
          }
          host.notify({
            type: "tool-result",
            result: { toolCallId: event.callId, toolName: event.name, output },
          });
          await send({
            type: "conversation-item-create",
            item: {
              type: "function-call-output",
              callId: event.callId,
              name: event.name,
              output: JSON.stringify(output ?? null),
            },
          });
          await send({ type: "response-create" });
        })();
        break;
      }
      case "error":
        // Server-side event errors are usually turn-scoped (e.g. a rejected
        // concurrent response.create), not fatal — surface for logging; a dead
        // session always arrives via the close handler.
        host.notify({ type: "error", message: event.message });
        break;
      default:
        // session-created / item bookkeeping / audio-done / custom — unused.
        break;
    }
  }
}
