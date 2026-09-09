import { describeWakeScreen } from "./agent/screen-on-wake";
import type { OpenDexConfig } from "./config/schema";
import type { ScreenHealth } from "./config/screen-health";

let health: ScreenHealth | null = null;
let generation = 0;
const listeners = new Set<(status: ScreenHealth) => void>();
let active: { controller: AbortController; result: Promise<string> } | null = null;
let observation: string | undefined;

/** Private model context, never part of the renderer's health payload. */
export function latestScreenObservation(): Promise<string> | undefined {
  return active?.result ?? (observation ? Promise.resolve(observation) : undefined);
}

export function getScreenHealth(config: OpenDexConfig): ScreenHealth {
  return health ?? { state: "idle", provider: config.llm.provider, model: config.llm.model };
}
export function onScreenHealth(listener: (status: ScreenHealth) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(status: ScreenHealth) {
  health = status;
  for (const listener of listeners) listener(status);
}
export function clearScreenHealth(config: OpenDexConfig) {
  generation++;
  active?.controller.abort();
  active = null;
  observation = undefined;
  publish({ state: "idle", provider: config.llm.provider, model: config.llm.model });
}

/** Automatic wake checks and explicit retries share one in-flight request. */
export function checkScreenHealth(config: OpenDexConfig, callerSignal?: AbortSignal): Promise<string> {
  if (active && !active.controller.signal.aborted) return active.result;
  const id = ++generation;
  const previous = getScreenHealth(config);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000), ...(callerSignal ? [callerSignal] : [])]);
  const base = { provider: config.llm.provider, model: config.llm.model };
  publish({ ...base, state: "checking" });
  const result = describeWakeScreen(config, signal, undefined, (issue) => {
    if (generation !== id) return;
    publish({ ...base, state: issue ? "error" : "ready", issue: issue ?? undefined, checkedAt: new Date().toISOString() });
  }).then((text) => {
    if (generation === id && !signal.aborted) observation = text;
    return text;
  }).finally(() => {
    if (generation !== id) return;
    active = null;
    if (health?.state === "checking") {
      publish(callerSignal?.aborted || controller.signal.aborted ? previous : {
        ...base, state: "error", issue: "connection", checkedAt: new Date().toISOString(),
      });
    }
  });
  active = { controller, result };
  return result;
}
