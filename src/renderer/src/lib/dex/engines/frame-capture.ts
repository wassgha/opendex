import { WebVoiceProcessor } from "@picovoice/web-voice-processor";
import { frameRms } from "./wav";
import type { CaptureOptions } from "./types";

// Shared mic-capture helper built on WebVoiceProcessor's 16kHz Int16 frames.
// Subscribes a frame sink, applies energy-based endpointing (trailing silence
// after some speech, or a hard timeout), then hands the collected frames to a
// transcriber. Used by every local/cloud STT engine so capture behaves
// identically regardless of backend.

const SPEECH_RMS = 0.015;
const MIN_SPEECH_FRAMES = 6;

export async function captureUtterance(
  opts: CaptureOptions,
  transcribe: (frames: Int16Array[]) => Promise<string>,
): Promise<string> {
  const frames: Int16Array[] = [];
  let speechFrames = 0;
  let lastVoiceAt = performance.now();
  const started = performance.now();
  let done = false;

  const engine = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage: (e: { command: string; inputFrame?: Int16Array }) => {
      if (done || e.command !== "process" || !e.inputFrame) return;
      frames.push(e.inputFrame.slice());
      if (frameRms(e.inputFrame) > SPEECH_RMS) {
        speechFrames += 1;
        lastVoiceAt = performance.now();
      }
    },
  };

  return new Promise<string>((resolve, reject) => {
    const finish = async (cancelled: boolean) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      try {
        await WebVoiceProcessor.unsubscribe(engine);
      } catch {
        // ignore
      }
      if (cancelled || speechFrames < MIN_SPEECH_FRAMES) return resolve("");
      try {
        resolve((await transcribe(frames)).trim());
      } catch (err) {
        reject(err);
      }
    };

    opts.signal?.addEventListener("abort", () => void finish(true), { once: true });

    const poll = setInterval(() => {
      const now = performance.now();
      if (now - started > opts.hardTimeoutMs) return void finish(false);
      if (speechFrames >= MIN_SPEECH_FRAMES && now - lastVoiceAt > opts.silenceMs) {
        void finish(false);
      }
    }, 100);

    WebVoiceProcessor.subscribe(engine).catch((err) => {
      clearInterval(poll);
      reject(err);
    });
  });
}

/** Concatenate Int16 frames into a single Float32Array (−1..1) for ML models. */
export function framesToFloat32(frames: Int16Array[]): Float32Array {
  let length = 0;
  for (const f of frames) length += f.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) out[offset++] = f[i] / 32768;
  }
  return out;
}
