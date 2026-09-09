import { configureLatencySummary } from "./latency-summary";
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// Local-only, bounded history. Raw audio, images, prompts and tool payloads are
// deliberately excluded by callers. Redaction is defense in depth, not a
// guarantee that arbitrary spoken personal information is removed.
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/\b(?:sk|sk-proj|sk-ant-api03)-[A-Za-z0-9_-]{12,}\b/g, '[redacted key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|password|access[_ -]?token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 16000);
  if (Array.isArray(value)) return value.slice(0, 100).map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k, /^(?:apiKey|password|secret|token|authorization|base64|image|audio|chunk)$/i.test(k) ? '[omitted]' : redact(v)]));
  return value;
}

export function createInteractionLog(directory: string, maxBytes = 5_000_000) {
  const path = join(directory, 'interactions.jsonl');
  return (event: string, detail: Record<string, unknown> = {}) => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (existsSync(path) && statSync(path).size >= maxBytes) {
        if (existsSync(path + '.1')) renameSync(path + '.1', path + '.2');
        renameSync(path, path + '.1');
      }
      appendFileSync(path, JSON.stringify(redact({ ...detail, event, at: Date.now() })) + '\n', { mode: 0o600 });
      chmodSync(path, 0o600);
    } catch {
      // A full/unwritable disk must never interrupt the voice session.
    }
  };
}
let write: ReturnType<typeof createInteractionLog> | undefined;
export function configureInteractionLog(directory: string) {
  configureLatencySummary(directory);
  write = createInteractionLog(directory);
  recordInteraction('app-start');
}
export function recordInteraction(event: string, detail: Record<string, unknown> = {}) {
  write?.(event, detail);
}
