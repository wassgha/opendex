import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import type { CaptureOptions, SttEngine } from "./types";
import { captureUtterance, framesToFloat32 } from "./frame-capture";

export interface ModelProgress {
  (info: { label: string; progress: number }): void;
}

// Lazily-created singletons keyed by model id, so the model loads once.
const pipelines = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

function getPipeline(model: string, onProgress?: ModelProgress) {
  let p = pipelines.get(model);
  if (!p) {
    p = pipeline("automatic-speech-recognition", model, {
      // Prefer WebGPU when available; transformers.js falls back to WASM.
      device: "webgpu",
      progress_callback: (e: { status?: string; progress?: number; file?: string }) => {
        if (e.status === "progress") {
          onProgress?.({
            label: `Downloading voice model… ${Math.round(e.progress ?? 0)}%`,
            progress: e.progress ?? 0,
          });
        }
      },
    }).catch((err) => {
      // Allow a later retry if loading failed.
      pipelines.delete(model);
      throw err;
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    pipelines.set(model, p);
  }
  return p;
}

/**
 * Fully-local, offline STT via transformers.js Whisper (WASM/WebGPU). Free, no
 * API key. The model downloads once (cached in the browser) on first use.
 */
export class WhisperSttEngine implements SttEngine {
  constructor(
    private readonly model: string,
    private readonly onProgress?: ModelProgress,
  ) {}

  /** Warm the model (triggers download) without capturing. */
  async preload(): Promise<void> {
    await getPipeline(this.model, this.onProgress);
  }

  capture(opts: CaptureOptions): Promise<string> {
    return captureUtterance(opts, async (frames) => {
      const transcriber = await getPipeline(this.model, this.onProgress);
      const audio = framesToFloat32(frames);
      const out = (await transcriber(audio)) as { text?: string } | { text?: string }[];
      const text = Array.isArray(out) ? out[0]?.text : out.text;
      return text ?? "";
    });
  }

  dispose(): void {}
}
