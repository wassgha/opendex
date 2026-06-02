import { WebVoiceProcessor } from "@picovoice/web-voice-processor";
import type { SttProvider } from "../../../../../main/config/schema";
import type { CaptureOptions, SttEngine } from "./types";
import { encodeWav, frameRms } from "./wav";

const SPEECH_RMS = 0.015; // frame loudness above which we count "speech"
const MIN_SPEECH_FRAMES = 6; // require some speech before silence can end capture

/**
 * Cloud STT: captures one utterance from the mic (via WebVoiceProcessor's 16kHz
 * Int16 frames), endpoints on trailing silence, encodes WAV, and sends it to
 * the main process for transcription (key stays in main).
 */
export class CloudSttEngine implements SttEngine {
  constructor(private readonly provider: SttProvider) {}

  capture(opts: CaptureOptions): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const frames: Int16Array[] = [];
      let speechFrames = 0;
      let lastVoiceAt = performance.now();
      let started = performance.now();
      let done = false;

      const engine = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: (e: { command: string; inputFrame?: Int16Array }) => {
          if (done || e.command !== "process" || !e.inputFrame) return;
          const frame = e.inputFrame;
          frames.push(frame.slice());
          if (frameRms(frame) > SPEECH_RMS) {
            speechFrames += 1;
            lastVoiceAt = performance.now();
          }
        },
      };

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
          const wav = encodeWav(frames);
          const text = await window.opendex.transcribe(this.provider, wav);
          resolve(text.trim());
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

  dispose(): void {
    // capture() cleans up its own subscription; nothing persistent to release.
  }
}
