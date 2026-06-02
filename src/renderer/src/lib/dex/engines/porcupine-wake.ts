import {
  PorcupineWorker,
  BuiltInKeyword,
} from "@picovoice/porcupine-web";
import { WebVoiceProcessor } from "@picovoice/web-voice-processor";
import type { EngineStatus, WakeEngine } from "./types";

// English Porcupine params, bundled in the renderer's public/ dir.
const PORCUPINE_MODEL = { publicPath: "models/porcupine_params.pv" };

function resolveKeyword(id: string): BuiltInKeyword {
  // Match the config string (e.g. "jarvis") to a built-in keyword.
  const match = (Object.values(BuiltInKeyword) as string[]).find(
    (k) => k.toLowerCase() === id.toLowerCase(),
  );
  return (match as BuiltInKeyword) ?? BuiltInKeyword.Jarvis;
}

/**
 * Hands-free wake word via Porcupine (WASM, in-renderer). Requires a Picovoice
 * AccessKey (fetched from main). Detection is offline once initialised.
 */
export class PorcupineWakeEngine implements WakeEngine {
  private worker: PorcupineWorker | null = null;

  constructor(
    private readonly accessKey: string,
    private readonly keyword: string,
    private readonly onStatus: (s: EngineStatus) => void,
  ) {}

  async start(onWake: () => void): Promise<void> {
    if (!this.accessKey) {
      this.onStatus("needs-key");
      return;
    }
    try {
      this.worker = await PorcupineWorker.create(
        this.accessKey,
        { builtin: resolveKeyword(this.keyword) },
        () => onWake(),
        PORCUPINE_MODEL,
      );
      await WebVoiceProcessor.subscribe(this.worker);
      this.onStatus("ok");
    } catch (err) {
      console.error("[opendex] porcupine init failed", err);
      this.onStatus("error");
      await this.dispose();
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      try {
        await WebVoiceProcessor.unsubscribe(this.worker);
      } catch {
        // ignore
      }
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.worker?.release();
    this.worker?.terminate();
    this.worker = null;
  }
}
