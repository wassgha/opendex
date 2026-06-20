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

// Computer-use returns a screenshot from every action, so the visual history
// piles up — and a naive loop re-sends EVERY past screenshot to the model on
// each step, which dominates latency and token cost. The model only needs the
// most recent frame(s) to decide the next action, so before each step we keep
// the last `KEEP_SCREENSHOTS` images and replace older ones with a text stub.
const KEEP_SCREENSHOTS = 2;

function hasImage(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    (output as { type?: string }).type === "content" &&
    Array.isArray((output as { value?: unknown[] }).value) &&
    (output as { value: Array<{ type?: string }> }).value.some(
      (c) => c.type === "media" || c.type === "file-data",
    )
  );
}

function pruneOldScreenshots(messages: ModelMessage[]): ModelMessage[] {
  // Collect every image-bearing tool-result part, in order.
  const imageParts: object[] = [];
  for (const m of messages) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part?.type === "tool-result" && hasImage(part.output)) imageParts.push(part);
    }
  }
  if (imageParts.length <= KEEP_SCREENSHOTS) return messages;

  const strip = new Set(imageParts.slice(0, imageParts.length - KEEP_SCREENSHOTS));
  return messages.map((m) => {
    if (m.role !== "tool" || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((part) => {
      if (strip.has(part as object)) {
        changed = true;
        return {
          ...part,
          output: {
            type: "text" as const,
            value: "[earlier screenshot omitted to save context]",
          },
        };
      }
      return part;
    });
    return changed ? { ...m, content } : m;
  });
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
    // Trim stale screenshots from the context before each step (no-op when
    // there are none, e.g. ordinary turns).
    prepareStep: ({ messages: stepMessages }) => ({
      messages: pruneOldScreenshots(stepMessages),
    }),
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
