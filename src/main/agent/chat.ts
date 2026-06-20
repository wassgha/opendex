import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

// Conversation messages are full ModelMessages so tool calls + tool results are
// carried across turns (otherwise the model forgets actions it already took and
// repeats them — e.g. re-asking permission to open the same URL).
export type ChatMessage = ModelMessage;

export interface StreamChatOptions {
  messages: ChatMessage[];
  /** Resolved system prompt (persona, plus greeting when this is a briefing). */
  system: string;
  /** AI Gateway model id. */
  model: string;
  /** Tool set for this turn (base tools + enabled, permission-gated skills). */
  tools?: ToolSet;
  /** Briefing turns are self-contained narration — tools are disabled. */
  briefing?: boolean;
  /** Max tool/generation steps before the loop stops. Defaults to 8. */
  maxSteps?: number;
  signal?: AbortSignal;
  /** Called with each text delta as it streams. */
  onDelta: (text: string) => void;
}

// Strip ANSI colour codes and noisy trailers from gateway errors before they
// are read aloud.
function sanitiseError(raw: string): string {
  const noAnsi = raw.replace(/\[[0-9;]*m/g, "");
  const firstLine = noAnsi.split(/\n/)[0]?.trim() || "an unknown error occurred";
  return firstLine.replace(/\.$/, "") + ".";
}

/**
 * Streams the agent's reply as text deltas (via `onDelta`) and resolves with the
 * assistant/tool messages it generated, so the caller can append them to the
 * conversation history. On a provider error the AI SDK's textStream completes
 * silently — we surface a spoken apology and record it as the assistant turn.
 */
export async function streamChat({
  messages,
  system,
  model,
  tools,
  briefing,
  maxSteps,
  signal,
  onDelta,
}: StreamChatOptions): Promise<ModelMessage[]> {
  let capturedError: unknown = null;
  const result = streamText({
    model,
    system,
    messages,
    tools: briefing ? undefined : tools,
    stopWhen: stepCountIs(maxSteps ?? 8),
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
      onDelta(delta);
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return [];
    capturedError = err;
  }

  if (signal?.aborted) return [];

  if (!emittedAny && capturedError) {
    const err = capturedError as Error;
    const apology = `Apologies, sir — ${sanitiseError(err.message ?? String(err))}`;
    onDelta(apology);
    return [{ role: "assistant", content: apology }];
  }

  // The generated assistant + tool messages (text, tool calls, tool results).
  return (await result.response).messages;
}
