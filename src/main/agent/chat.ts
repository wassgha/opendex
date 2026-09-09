import { beginUsage, finishUsage } from "../usage/ledger";
import { isActiveBenchmarkUrl } from "../benchmarks/host";
import { toolFailureCode } from '../diagnostics/tool-outcome';
import { EMAIL_OVERVIEW_TOOLS, isEmailOverview } from "./email-overview";
import { languageUnits, modelIdentity, priceUsage, reportedCharge, unknownCharge } from "../usage/pricing";
import { randomUUID } from "node:crypto";
import { recordInteraction } from "../diagnostics/interaction-log";
import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { BROWSER_RESEARCH_RULE, isBrowserResearch, withBrowserResearchPolicy } from "./browser-research-policy";
import { withResearchStart } from "./research-start";
import { researchReasoning, researchActionTools } from "./research-reasoning";
import { ModelWait } from "./model-wait";
import { researchStepLimit } from "./research-budget";
import { latencySpan } from "./latency";

// Conversation messages are full ModelMessages so tool calls + tool results are
// carried across turns (otherwise the model forgets actions it already took and
// repeats them — e.g. re-asking permission to open the same URL).
export type ChatMessage = ModelMessage;

export interface StreamChatOptions {
  messages: ChatMessage[];
  /** Resolved system prompt (persona, plus greeting when this is a briefing). */
  system: string;
  /** Resolved model: an AI SDK `LanguageModel` (direct providers / apple) or a
   *  bare model-id string (the gateway path). See agent/llm/resolve-model.ts. */
  model: LanguageModel;
  /** Tool set for this turn (base tools + enabled, permission-gated skills). */
  tools?: ToolSet;
  /** Briefing turns are self-contained narration — tools are disabled. */
  briefing?: boolean;
  signal?: AbortSignal;
  /** Silent model wait limit; tools and permission dialogs are excluded. */
  modelWaitMs?: number;
  /** Validated main-owned exact-task archive delegation. */
  archiveTask?: boolean;
  /** Called with each text delta as it streams. */
  onDelta: (text: string) => void;
  /** Called when the model invokes a tool, so the UI can surface activity. */
  onToolCall?: (call: { toolCallId: string; toolName: string; input: unknown }) => void;
  /** Called when a tool returns, so the UI can render a result card. */
  onToolResult?: (result: {
    toolCallId: string;
    toolName: string;
    output: unknown;
  }) => void;
}

// Computer-use returns a screenshot from every action, so the visual history
// piles up — and a naive loop re-sends EVERY past screenshot to the model on
// each step, which dominates latency and token cost. The model only needs the
// most recent frame(s) to decide the next action, so before each step we keep
// the last `KEEP_SCREENSHOTS` images and replace older ones with a text stub.
const KEEP_SCREENSHOTS = 2;

// Tool/generation steps before the loop stops. Generous so multi-step tasks
// (e.g. a computer-use screenshot→act→screenshot loop) can run to completion.

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

// Deep-clone a value for logging with long strings truncated, so dumping the
// conversation doesn't spew base64 screenshots / huge tool outputs to the console.
function loggable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "string" && v.length > 600
        ? `${v.slice(0, 600)}…[${v.length} chars]`
        : v,
    ),
  );
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
  signal,
  onDelta,
  onToolCall,
  onToolResult,
  modelWaitMs,
  archiveTask = false,
}: StreamChatOptions): Promise<ModelMessage[]> {
  const lastUser = messages.filter(m => m.role === "user").at(-1);
  if (typeof lastUser?.content === "string") recordInteraction("desktop-request", { text: lastUser.content });
  let capturedError: unknown = null;
  const trace = latencySpan("desktop-agent", { model: typeof model === "string" ? model : model.modelId });
  const modelWait = new ModelWait(modelWaitMs);
  const combinedSignal = signal ? AbortSignal.any([signal, modelWait.controller.signal]) : modelWait.controller.signal;
  const emailOverview = !briefing && isEmailOverview(messages);
  if (emailOverview) {
    tools = Object.fromEntries(Object.entries(tools ?? {}).filter(([name]) => EMAIL_OVERVIEW_TOOLS.has(name)));
    system += "\nThis is an inbox overview only. Do not open message rows. Once the inbox is visible, read the visible rows (one zoom if needed) and return a short digest immediately. Fewer than five clearly legible rows is acceptable: report that limit rather than navigating repeatedly. Stop at login/account selection. No clicking, typing or message mutations are available for this overview.";
  }
  if (archiveTask) system += "\nThis is a bounded exact-task archive. Prefer the visible task menu; zoom before targeting small controls. After two unsuccessful attempts at the same control, stop and report the blocker. Do not explore unrelated UI. Verify the archive and immediately return that result.";
  system += `\n\n${BROWSER_RESEARCH_RULE}`;
  tools = withBrowserResearchPolicy(tools, isBrowserResearch(messages), isActiveBenchmarkUrl);
  tools = withResearchStart(tools, {
    onToolCall: call => { trace.mark("tool-call", { tool: call.toolName, call: call.toolCallId }); onToolCall?.(call); },
    onToolResult: result => { trace.mark("tool-result", { tool: result.toolName, call: result.toolCallId }); onToolResult?.(result); },
  });
  const usageGroup = randomUUID();
  const identity = modelIdentity(model);
  let usageId: string | undefined;
  const runningTools = new Set<string>();
  let step = 0;
  let firstText = true;

  // Debug: exactly what we send to the LLM this turn (system prompt, full
  // conversation, and available tool names). Long strings are truncated.
  console.log("[opendex chat] → request", {
    briefing: !!briefing,
    tools: briefing ? [] : Object.keys(tools ?? {}),
    system,
    messages: loggable(messages),
  });

  const result = streamText({
    model,
    system,
    messages,
    tools: briefing ? undefined : tools,
    stopWhen: ({ steps }) => steps.length >= researchStepLimit(steps),
    // SDK callbacks run before the next prepareStep. The buffered fullStream
    // consumer can lag behind and must not assign a prior step's usage to a new one.
    onStepFinish: ({ usage, providerMetadata }) => {
      if (!usageId) return;
      const units = languageUnits(usage);
      finishUsage(usageId, units, reportedCharge(providerMetadata) ?? priceUsage(identity.provider, identity.model, units));
      usageId = undefined;
    },
    // Trim stale screenshots from the context before each step (no-op when
    // there are none, e.g. ordinary turns).
    prepareStep: ({ messages: stepMessages, steps }) => {
      if (usageId) finishUsage(usageId, {}, unknownCharge("Final usage was not returned."), true);
      usageId = beginUsage({ ...identity, category: "conversation", groupId: usageGroup });
      modelWait.waiting();
      firstText = true;
      trace.mark("model-step-start", { step: ++step });
      const remaining = researchStepLimit(steps) - steps.length;
      const providerOptions = (archiveTask || emailOverview) && typeof model !== "string" && model.modelId === "gpt-5" && model.provider.startsWith("openai.")
        ? { openai: { reasoningEffort: "low" } } : researchReasoning(model, messages, steps);
      const activeTools = researchActionTools(Object.keys(tools ?? {}), steps);
      trace.mark("model-reasoning-setting", { step, effort: providerOptions?.openai.reasoningEffort ?? "default" });
      return {
        messages: pruneOldScreenshots(stepMessages),
        ...(emailOverview && steps.length >= 5 ? { toolChoice: "none" as const, system: `${system}\nFinish the inbox overview now using only already-visible evidence. Clearly state any unreadable rows or login/account blocker. Do not request more tools or claim unseen content.` } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        ...(activeTools ? { activeTools } : {}),
        ...(remaining <= 6 ? { system: `${system}\n\nYou have ${remaining} steps left. Finish gathering only essential missing evidence, update the research record if used, and provide the final answer with sources and explicit gaps. Do not start another broad search or claim unverified completion.` } : {}),
      };
    },
    abortSignal: combinedSignal,
    onError: ({ error }) => {
      capturedError = error;
      console.error("[opendex chat] streamText error", error);
    },
  });

  let emittedAny = false;
  // Debug: accumulate what the model produces so we can log the full reply.
  let fullText = "";
  const toolCallsLog: Array<{ toolName: string; input: unknown }> = [];
  let finishReason: string | undefined;
  try {
    // Iterate the full stream (not just textStream) so we can forward tool-call
    // events for the activity UI alongside the text deltas.
    for await (const part of result.fullStream) {
      if (part.type === "start-step") {
        trace.mark("provider-stream-ready", { step });
      } else if (part.type === "reasoning-start" || part.type === "reasoning-end") {
        // Record phase timing only; never retain or narrate reasoning content.
        trace.mark(part.type, { step });
      } else if (part.type === "tool-input-start") {
        trace.mark("action-generation-start", { step, tool: part.toolName });
      } else if (part.type === "text-delta") {
        if (firstText) { trace.mark("first-text", { step }); firstText = false; }
        if (part.text.length === 0) continue;
        if (runningTools.size === 0) modelWait.waiting();
        emittedAny = true;
        fullText += part.text;
        onDelta(part.text);
      } else if (part.type === "tool-call") {
        runningTools.add(part.toolCallId);
        modelWait.pause();
        trace.mark("tool-call", { step, tool: part.toolName, call: part.toolCallId });
        toolCallsLog.push({ toolName: part.toolName, input: part.input });
        onToolCall?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
      } else if (part.type === "tool-error") {
        runningTools.delete(part.toolCallId);
        trace.mark("tool-error", { step, tool: part.toolName, call: part.toolCallId, errorName: (part.error as Error)?.name });
        onToolResult?.({ toolCallId: part.toolCallId, toolName: part.toolName, output: { error: "The tool could not complete this action.", code: toolFailureCode(part.error) } });
      } else if (part.type === "tool-result") {
        runningTools.delete(part.toolCallId);
        trace.mark("tool-result", { step, tool: part.toolName, call: part.toolCallId });
        onToolResult?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
      } else if (part.type === "finish-step") {
        modelWait.pause();
        finishReason = part.finishReason;
        trace.mark("model-step-end", { step, usage: part.usage, finishReason });
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError" && signal?.aborted) return [];
    capturedError = err;
  } finally {
    if (usageId) finishUsage(usageId, {}, unknownCharge("Request ended before final usage arrived. Charges may still apply."), true);
    modelWait.pause();
  }
  if (modelWait.timedOut) {
    capturedError = modelWait.controller.signal.reason;
    recordInteraction("model-wait-timeout", { step, limitMs: modelWaitMs ?? 90000 });
  }

  // Some providers terminate with finishReason=error without an error chunk or
  // onError callback (including Responses response.failed). Never turn this, or
  // a completely empty response, into a successful desktop report.
  const silentFailure = !signal?.aborted && !capturedError &&
    (finishReason === "error" || (!fullText.trim() && toolCallsLog.length === 0));
  if (silentFailure) {
    capturedError = new Error(`The task model ${finishReason === "length" ? "reached its output token limit without a usable response" : finishReason === "error" ? "reported a failed response" : "returned an empty response"}${toolCallsLog.length === 0 ? " before taking any action" : " after starting the task"}. The task is incomplete. This does not establish a browser, sign-in or screen-permission problem. Do not suggest changing those settings without tool evidence.`);
  }

  recordInteraction("desktop-result", { text: fullText, failed: Boolean(capturedError), cancelled: Boolean(signal?.aborted) });
  // Debug: what the model actually returned this turn.
  trace.mark("complete", { steps: step, characters: fullText.length });
  console.log("[opendex chat] ← response", {
    finishReason: modelWait.timedOut ? "model-wait-timeout" : await Promise.resolve(result.finishReason).catch(() => "unknown"),
    text: fullText,
    toolCalls: loggable(toolCallsLog),
    error: capturedError ? String(capturedError) : undefined,
  });

  if (signal?.aborted) return [];
  if (silentFailure) throw capturedError;

  if (modelWait.timedOut) {
    const message = "The research or task agent stopped making visible progress, so I ended the wait. The task is incomplete. You can ask me to try again.";
    onDelta(message);
    return [{ role: "assistant", content: [fullText, message].filter(Boolean).join("\n\n") }];
  }

  if (!emittedAny && capturedError) {
    const err = capturedError as Error;
    const apology = `Apologies, sir — ${sanitiseError(err.message ?? String(err))}`;
    onDelta(apology);
    return [{ role: "assistant", content: apology }];
  }

  // The generated assistant + tool messages (text, tool calls, tool results).
  return (await result.response).messages;
}
