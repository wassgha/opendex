import { recordInteraction } from "../diagnostics/interaction-log";
import { createSpanObserver } from "../diagnostics/latency-summary";
import { randomUUID } from "node:crypto";

/** Local timing marks; console mirroring is opt-in. Summary aggregation drops all metadata. */
export function latencySpan(name: string, metadata: Record<string, unknown> = {}) {
  const start = performance.now();
  const observe = createSpanObserver(name);
  const id = randomUUID().slice(0, 8);
  const mark = (event: string, detail: Record<string, unknown> = {}) => {
    observe(event, performance.now() - start, detail);
    recordInteraction("timing", { id, name, stage: event, ms: Math.round(performance.now() - start), ...metadata, ...detail });
    if (process.env.OPENDEX_PROFILE !== "1") return;
    console.info("[latency] " + JSON.stringify({ id, name, event, at: Date.now(), ms: Math.round(performance.now() - start), ...metadata, ...detail }));
  };
  mark("start");
  return { mark };
}
