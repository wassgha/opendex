// Lightweight console instrumentation for the voice pipeline. Each `vlog` call
// prints the elapsed time since the previous event so you can see exactly where
// latency accrues between "user stopped talking" and "assistant starts acting":
//
//   [voice-timing] +    0ms  capture:start { mode: 'command', provider: 'openai' }
//   [voice-timing] + 6000ms  endpoint:silence { silenceMs: 6000, speechFrames: 41, captureMs: 8421 }
//   [voice-timing] +  742ms  transcribe:done { provider: 'openai', chars: 37 }
//   [voice-timing] +    3ms  runCommand:start
//   [voice-timing] +  610ms  model:first-token
//   [voice-timing] +  120ms  tts:first-enqueue
//
// Deltas are between consecutive events on a single shared timeline (both the
// STT engines and the orchestrator log here), so overlapping turns read in order.

let lastTs: number | null = null;

export function vlog(event: string, detail?: Record<string, unknown>): void {
  const now = performance.now();
  const delta = lastTs === null ? 0 : now - lastTs;
  lastTs = now;
  const pad = `+${Math.round(delta)}ms`.padStart(8);
  if (detail) {
    console.log(`[voice-timing] ${pad}  ${event}`, detail);
  } else {
    console.log(`[voice-timing] ${pad}  ${event}`);
  }
}
