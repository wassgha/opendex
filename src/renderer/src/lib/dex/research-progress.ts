import type { ModelMessage } from "ai";
import type { ResearchUpdate } from "@skills/research/schema";

/** Narration is driven by reported discoveries, never a periodic timer. */
export class ResearchMilestones {
  private lastAt = -Infinity;
  private lastText = "";
  next(update: ResearchUpdate, now: number, speaking: boolean): string | undefined {
    if (speaking || update.stage === "complete" || ["none", "plan"].includes(update.milestone)) return;
    if (!update.update || update.update === this.lastText || now - this.lastAt < 15000) return;
    this.lastAt = now; this.lastText = update.update;
    return update.update;
  }
}

/** Earlier assistant text can be a plan or interim observation, not a report. */
export function delegatedReport(messages: ModelMessage[], fallback: string): string {
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    if (typeof last.content === "string") return last.content.trim() || "The task ended without a final report.";
    if (last.content.some(part => part.type === "tool-call")) return "The task reached its limit before producing a final report. Do not claim completion; use the research record to explain the remaining gaps.";
    const text = last.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    if (text) return text;
  }
  if (messages.length) return "The task ended after a tool action without a final report. Do not claim completion; explain what remains unverified.";
  return fallback.trim() || "The task finished with no report.";
}
