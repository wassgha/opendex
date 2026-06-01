import { stepCountIs, streamText, type ModelMessage } from "ai";
import { tools } from "./tools";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  /** Resolved system prompt (persona, plus greeting when this is a briefing). */
  system: string;
  /** AI Gateway model id. */
  model: string;
  /** Briefing turns are self-contained narration — tools are disabled. */
  briefing?: boolean;
  signal?: AbortSignal;
}

// Strip ANSI colour codes and noisy trailers from gateway errors before they
// are read aloud.
function sanitiseError(raw: string): string {
  const noAnsi = raw.replace(/\[[0-9;]*m/g, "");
  const firstLine = noAnsi.split(/\n/)[0]?.trim() || "an unknown error occurred";
  return firstLine.replace(/\.$/, "") + ".";
}

/**
 * Streams the agent's reply as plain text deltas. On an underlying provider
 * error (e.g. missing/invalid API key) the AI SDK's textStream completes
 * silently — so we capture the error and yield a spoken apology instead.
 */
export async function* streamChat({
  messages,
  system,
  model,
  briefing,
  signal,
}: StreamChatOptions): AsyncIterable<string> {
  let capturedError: unknown = null;
  const result = streamText({
    model,
    system,
    messages: messages.map((m): ModelMessage => ({ role: m.role, content: m.content })),
    tools: briefing ? undefined : tools,
    stopWhen: stepCountIs(5),
    abortSignal: signal,
    onError: ({ error }) => {
      capturedError = error;
      console.error("[opendex chat] streamText error", error);
    },
  });

  let emittedAny = false;
  try {
    for await (const delta of result.textStream) {
      if (delta.length === 0) continue;
      emittedAny = true;
      yield delta;
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    capturedError = err;
  }

  if (!emittedAny && capturedError) {
    const err = capturedError as Error;
    yield `Apologies, sir — ${sanitiseError(err.message ?? String(err))}`;
  }
}
