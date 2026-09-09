import { mkdir, rename, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PHASES = {
  'model-first-text': 'Try a lower-latency model or reasoning setting; reduce unnecessary context, then compare the same task.',
  'tool-round-trip': 'Inspect tool execution and permission wait separately; reduce redundant calls without bypassing approvals.',
  'screen-capture': 'Check capture resolution and repeated captures; retain enough detail for accurate targeting.',
  'screen-description': 'Compare a faster vision model and smaller relevant images.',
  'realtime-connect': 'Inspect token minting and network setup; compare warm and cold connections.',
  'realtime-first-audio': 'Compare model and network performance; this excludes speaker playback and input endpointing.',
  'cloud-transcription': 'Compare transcription providers on the same utterance; preserve recognition accuracy.',
  'speech-synthesis': 'Compare shorter sentence chunks or a faster voice model; check playback continuity.',
} as const;
export type Phase = keyof typeof PHASES;
export type Samples = Partial<Record<Phase, number[]>>;
const LIMIT = 200;
export function sanitizeSamples(value: unknown): Samples {
  const result: Samples = {};
  if (!value || typeof value !== 'object') return result;
  for (const phase of Object.keys(PHASES) as Phase[]) {
    const values = (value as Samples)[phase];
    if (Array.isArray(values)) result[phase] = values.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 3_600_000).slice(-LIMIT).map(Math.round);
  }
  return result;
}
export function readLatencySamples(directory: string): Samples {
  try {
    const path = join(directory, 'latency-summary.json');
    if (statSync(path).size > 100_000) return {};
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data.version === 1 ? sanitizeSamples(data.samples) : {};
  } catch { return {}; }
}
export function latencyReport(samples: Samples) {
  const rows = Object.entries(sanitizeSamples(samples)).flatMap(([phase, values]) => {
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const mean = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) / v.length);
    const half = Math.floor(values.length / 2);
    return [{ phase, count: values.length, meanMs: mean(values), p50Ms: sorted[Math.ceil(sorted.length * .5) - 1],
      p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1)!,
      recentMeanChangeMs: half >= 5 ? mean(values.slice(half)) - mean(values.slice(0, half)) : null,
      suggestion: PHASES[phase as Phase] }];
  }).sort((a, b) => b.meanMs - a.meanMs);
  return { version: 1, dominantPhase: rows[0] && rows[0].meanMs >= 100 && (!rows[1] || rows[0].meanMs >= rows[1].meanMs * 1.5) ? rows[0].phase : null,
    phases: rows, note: 'Last 200 completed intervals per phase across runs. Ranked by mean duration, not causal share of a turn: phases can overlap and have different sample counts. Trend compares older/newer halves, not a controlled benchmark. Missing/aborted intervals are excluded. No transcript, identifiers, model names or tool payloads are stored. No automatic configuration changes.' };
}

/** Small, debounced, atomic local snapshot. Disk failures never affect voice. */
export function createLatencyStore(directory: string) {
  const samples = readLatencySamples(directory);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const data = JSON.stringify({ version: 1, samples: sanitizeSamples(samples) });
    writes = writes.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, 'latency-summary.json');
      await writeFile(path + '.tmp', data, { mode: 0o600 });
      await rename(path + '.tmp', path);
    }).catch(() => {});
    return writes;
  };
  return { samples, flush, add(phase: Phase, ms: number) {
    if (!Object.hasOwn(PHASES, phase) || !Number.isFinite(ms) || ms < 0 || ms > 3_600_000) return;
    const values = samples[phase] ??= [];
    values.push(Math.round(ms));
    if (values.length > LIMIT) values.shift();
    if (!timer) { timer = setTimeout(() => { void flush(); }, 1000); timer.unref(); }
  } };
}
let store: ReturnType<typeof createLatencyStore> | undefined;
export function configureLatencySummary(directory: string) { store = createLatencyStore(directory); }
export function recordLatency(phase: Phase, ms: number) { store?.add(phase, ms); }

/** Correlation stays in memory; only a fixed phase and elapsed number leave this closure. */
export function createSpanObserver(name: string, emit = recordLatency) {
  const pending = new Map<string, number>();
  const pairs: Record<string, [string, string, Phase][]> = {
    'desktop-agent': [['start', 'first-text', 'model-first-text']],
    capture: [['start', 'encoded', 'screen-capture']],
    'wake-vision': [['start', 'complete', 'screen-description']],
    realtime: [['start', 'configured', 'realtime-connect'], ['response-created', 'first-audio', 'realtime-first-audio']],
  };
  return (stage: string, ms: number, detail: Record<string, unknown> = {}) => {
    for (const [start, end, phase] of pairs[name] ?? []) {
      if (stage === start) pending.set(phase, ms);
      if (stage === end && pending.has(phase)) { emit(phase, ms - pending.get(phase)!); pending.delete(phase); }
    }
    if (stage === 'response-done') pending.delete('realtime-first-audio');
    if (typeof detail.call !== 'string') return;
    const key = 'tool:' + detail.call;
    if (stage === 'tool-call' && pending.size < 100) pending.set(key, ms);
    if ((stage === 'tool-result' || stage === 'tool-error') && pending.has(key)) {
      emit('tool-round-trip', ms - pending.get(key)!); pending.delete(key);
    }
  };
}
