import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanUnits, unknownCharge } from "./pricing";
import type { UsageCategory, UsageCharge, UsageHistory, UsageRecord, UsageSummary, UsageTotal, UsageUnits } from "./types";

export interface UsageStart { provider: string; model: string; category: UsageCategory; groupId?: string; id?: string }
const empty = (): UsageTotal => ({ usd: 0, reported: 0, estimated: 0, unavailable: 0, pending: 0, requests: 0 });
function add(total: UsageTotal, row: UsageRecord) {
  total.requests++;
  if (row.status === "pending") total.pending++;
  else if (row.usd === null) total.unavailable++;
  if (row.usd !== null) total.usd += row.usd;
  if (row.confidence === "estimated") total.estimated++;
  if (row.confidence === "reported") total.reported++;
}

/** Append-only accounting journal, separate from rotating diagnostic transcripts.
 * Pending entries survive crashes and become unconfirmed, never zero-dollar calls.
 * Updates use stable IDs so repeated provider completion events cannot double bill.
 */
export class UsageLedger {
  private records = new Map<string, UsageRecord>();
  readonly runId = randomUUID();
  readonly runStartedAt = new Date().toISOString();
  private file: string;
  private error: string | null = null;
  constructor(directory: string, private changed: () => void = () => {}) {
    this.file = join(directory, "ledger.jsonl");
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (existsSync(this.file)) {
        const content = readFileSync(this.file, "utf8");
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line) as UsageRecord;
            if (!row.id || !row.startedAt || !row.units || !["pending", "completed", "interrupted"].includes(row.status) || (row.usd !== null && (typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd < 0))) throw new Error();
            this.records.set(row.id, row);
          } catch { this.error = "Some saved usage could not be read. Totals may be incomplete."; }
        }
        // Separate a torn final write from the next record without modifying old data.
        if (content && !content.endsWith("\n")) appendFileSync(this.file, "\n");
      }
      for (const row of this.records.values()) {
        if (row.status === "pending") this.save({ ...row, status: "interrupted", ...unknownCharge("Dex closed before final usage arrived. This request may have incurred a charge.") });
      }
    } catch { this.error = "Usage history could not be opened. Spending totals may be incomplete."; }
  }
  private save(row: UsageRecord) {
    this.records.set(row.id, row);
    try { appendFileSync(this.file, JSON.stringify(row) + "\n", { mode: 0o600 }); }
    catch { this.error = "Usage could not be saved. Current totals may not survive a restart."; }
    this.changed();
  }
  start(start: UsageStart): string {
    const id = start.id ?? randomUUID();
    if (this.records.has(id)) return id;
    this.save({ id, runId: this.runId, groupId: start.groupId ?? id, startedAt: new Date().toISOString(), provider: start.provider.slice(0, 100), model: start.model.slice(0, 200), category: start.category, status: "pending", units: {}, ...unknownCharge("Request in progress. Cost is pending.") });
    return id;
  }
  finish(id: string, units: UsageUnits, charge: UsageCharge, interrupted = false) {
    const previous = this.records.get(id);
    if (!previous || previous.status !== "pending") return;
    const valid = charge.usd === null || (Number.isFinite(charge.usd) && charge.usd >= 0);
    this.save({ ...previous, finishedAt: new Date().toISOString(), status: interrupted ? "interrupted" : "completed", units: cleanUnits(units), ...(valid ? charge : unknownCharge()) });
  }
  interruptGroup(groupId: string) {
    for (const row of this.records.values()) if (row.groupId === groupId && row.status === "pending") this.finish(row.id, row.units, unknownCharge("Connection ended before final usage arrived. Charges may still apply."), true);
  }
  summary(now = new Date()): UsageSummary {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const result: UsageSummary = { since: null, runStartedAt: this.runStartedAt, updatedAt: now.toISOString(), error: this.error, launch: empty(), today: empty(), month: empty(), all: empty(), connections: [], categories: [] };
    const connections = new Map<string, UsageSummary["connections"][number]>();
    const categories = new Map<UsageCategory, UsageSummary["categories"][number]>();
    for (const row of this.records.values()) {
      if (!result.since || row.startedAt < result.since) result.since = row.startedAt;
      add(result.all, row);
      if (row.runId === this.runId) add(result.launch, row);
      if (row.startedAt >= todayStart) add(result.today, row);
      if (row.startedAt >= monthStart) add(result.month, row);
      const key = JSON.stringify([row.provider, row.model]);
      const c = connections.get(key) ?? { provider: row.provider, model: row.model, total: empty() };
      add(c.total, row); connections.set(key, c);
      const category = categories.get(row.category) ?? { category: row.category, total: empty() };
      add(category.total, row); categories.set(row.category, category);
    }
    result.connections = [...connections.values()].sort((a, b) => b.total.usd - a.total.usd);
    result.categories = [...categories.values()].sort((a, b) => b.total.usd - a.total.usd);
    return result;
  }
  history(offset = 0): UsageHistory {
    const rows = [...this.records.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return { records: rows.slice(offset, offset + 100), total: rows.length };
  }
}

let ledger: UsageLedger | undefined;
export function initUsage(directory: string, changed: () => void) { ledger = new UsageLedger(directory, changed); }
export function usageSummary() { if (!ledger) throw new Error("Usage tracking is not ready."); return ledger.summary(); }
export function usageHistory(offset: number) { if (!ledger) throw new Error("Usage tracking is not ready."); return ledger.history(offset); }
export function beginUsage(start: UsageStart) { return ledger?.start(start) ?? randomUUID(); }
export function finishUsage(id: string, units: UsageUnits, charge: UsageCharge, interrupted = false) { ledger?.finish(id, units, charge, interrupted); }
export function interruptUsageGroup(id: string) { ledger?.interruptGroup(id); }
