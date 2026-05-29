import { stepCountIs, streamText, type ModelMessage } from "ai";
import { tools } from "@/lib/ai/tools";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";

export const maxDuration = 60;

// Strip ANSI colour codes and noisy "Learn more" trailers from gateway errors
// before reading them aloud.
function sanitiseError(raw: string): string {
  const noAnsi = raw.replace(/\[[0-9;]*m/g, "");
  const firstLine = noAnsi.split(/\n/)[0]?.trim() || "an unknown error occurred";
  return firstLine.replace(/\.$/, "") + ".";
}

interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "Missing 'messages'." }, { status: 400 });
  }

  const messages: ModelMessage[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let capturedError: unknown = null;
  const result = streamText({
    model: process.env.JARVIS_MODEL ?? "anthropic/claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(5),
    onError: ({ error }) => {
      capturedError = error;
      console.error("[jarvis chat] streamText error", error);
    },
  });

  // Hand-rolled text stream: forward deltas as they arrive, and if the
  // underlying call errored (textStream completes silently in that case),
  // emit an inline apology so the user hears *something*.
  const encoder = new TextEncoder();
  let emittedAny = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) {
          if (delta.length === 0) continue;
          emittedAny = true;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        capturedError = err;
      }
      if (!emittedAny && capturedError) {
        const err = capturedError as Error;
        const summary = sanitiseError(err.message ?? String(err));
        const apology = `Apologies, sir — ${summary}`;
        controller.enqueue(encoder.encode(apology));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
