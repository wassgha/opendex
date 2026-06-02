import type { CaptureOptions, SttEngine } from "./types";
import { captureUtterance } from "./frame-capture";
import { loadVoskModel, floatFromFrame } from "./vosk-model";

/**
 * Fully-local, offline STT via Vosk (WASM). Free, no key. Captures an utterance
 * (energy-endpointed), feeds it to a Kaldi recognizer, and returns the final
 * transcript.
 */
export class VoskSttEngine implements SttEngine {
  constructor(
    private readonly modelUrl: string | undefined,
    private readonly onLoading?: (loading: boolean) => void,
  ) {}

  async preload(): Promise<void> {
    this.onLoading?.(true);
    try {
      await loadVoskModel(this.modelUrl);
    } finally {
      this.onLoading?.(false);
    }
  }

  capture(opts: CaptureOptions): Promise<string> {
    return captureUtterance(opts, (frames) => this.transcribe(frames));
  }

  private async transcribe(frames: Int16Array[]): Promise<string> {
    const model = await loadVoskModel(this.modelUrl);
    const rec = new model.KaldiRecognizer(16000);

    return new Promise<string>((resolve) => {
      const parts: string[] = [];
      let finalizing = false;
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          rec.remove();
        } catch {
          // ignore
        }
      };

      rec.on("result", (m) => {
        if (m.result?.text) parts.push(m.result.text);
        if (finalizing) {
          cleanup();
          resolve(parts.join(" ").trim());
        }
      });

      for (const frame of frames) {
        rec.acceptWaveformFloat(floatFromFrame(frame), 16000);
      }
      finalizing = true;
      rec.retrieveFinalResult();

      // Fallback if no final event arrives.
      const timer = setTimeout(() => {
        cleanup();
        resolve(parts.join(" ").trim());
      }, 2500);
    });
  }

  dispose(): void {}
}
