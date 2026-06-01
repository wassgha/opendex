import { stepCountIs, streamText, type ModelMessage } from "ai";
import { tools } from "./tools";
import { SYSTEM_PROMPT, BRIEFING_SYSTEM_PROMPT } from "./system-prompt";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  mode?: "briefing";
  signal?: AbortSignal;
}

// Strip ANSI colour codes and noisy trailers from gateway errors before they
// are read aloud. (Ported from the former app/api/chat/route.ts.)
function sanitiseError(raw: string): string {
  const noAnsi = raw.replace(/\[[0-9;]*m/g, "");
  const firstLine = noAnsi.split(/\n/)[0]?.trim() || "an unknown error occurred";
  return firstLine.replace(/\.$/, "") + ".";
}

/**
 * Streams the agent's reply as plain text deltas. Yields each chunk as it
 * arrives. On an underlying provider error (e.g. missing/invalid API key), the
 * AI SDK's textStream completes silently — so we capture the error and yield a
 * spoken apology instead, exactly as the old HTTP route did.
 */
export async function* streamChat({
  messages,
  mode,
  signal,
}: StreamChatOptions): AsyncIterable<string> {
  const isBriefing = mode === "briefing";

  let capturedError: unknown = null;
  const result = streamText({
    model: process.env.OPENDEX_MODEL ?? process.env.JARVIS_MODEL ?? "anthropic/claude-sonnet-4-6",
    system: isBriefing ? BRIEFING_SYSTEM_PROMPT : SYSTEM_PROMPT,
    messages: messages.map((m): ModelMessage => ({ role: m.role, content: m.content })),
    // The briefing is self-contained narration — disabling tools keeps it from
    // stalling mid-monologue.
    tools: isBriefing ? undefined : tools,
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
