import { WakeAudioBuffer, type WakeAudio } from "./wake-audio";
import { WebVoiceProcessor } from "@picovoice/web-voice-processor";
import type { KaldiRecognizer } from "vosk-browser";
import type { EngineStatus, WakeEngine } from "./types";
import { loadVoskModel, floatFromFrame } from "./vosk-model";
import { wakeCommandFromResult } from "./wake-match";

/**
 * Fully-local, offline, no-signup hands-free wake word via Vosk (WASM). A Kaldi
 * recognizer listens continuously and fires on a completed direct-address phrase.
 */
export class VoskWakeEngine implements WakeEngine {
  private rec: KaldiRecognizer | null = null;
  private sink: { postMessage: (e: { command: string; inputFrame?: Int16Array }) => void; onmessage: null } | null =
    null;
  private audio = new WakeAudioBuffer();
  private fired = false;
  private stopped = false;

  constructor(
    private readonly wakeWord: string,
    private readonly modelUrl: string | undefined,
    private readonly onStatus: (s: EngineStatus) => void,
    private readonly onLoading?: (loading: boolean) => void,
  ) {}

  async start(onWake: (initialText?: string, audio?: WakeAudio) => void): Promise<void> {
    const word = this.wakeWord.trim().toLowerCase() || "computer";
    try {
      this.onLoading?.(true);
      const model = await loadVoskModel(this.modelUrl);
      if (this.stopped) return;
      this.onLoading?.(false);
      // Keep competing words: a keyword-only grammar can force unrelated
      // sounds into the wake word, and proper names may be out of vocabulary.
      this.rec = new model.KaldiRecognizer(16000);
      this.rec.setWords(true);

      const trigger = (initialText: string, audio?: WakeAudio) => {
        if (this.fired || this.stopped) return;
        this.fired = true;
        onWake(initialText || undefined, audio);
      };
      this.rec.on("result", (m) => {
        const initialText = wakeCommandFromResult(m.result?.result, word);
        if (initialText !== null) {
          const words = m.result?.result;
          const first = words?.[0];
          const last = words?.at(-1);
          trigger(initialText, first && last ? this.audio.utterance(first.start, last.end) : undefined);
        }
      });

      this.sink = {
        onmessage: null,
        postMessage: (e) => {
          if (!this.stopped && !this.fired && e.command === "process" && e.inputFrame && this.rec) {
            this.audio.push(e.inputFrame);
            this.rec.acceptWaveformFloat(floatFromFrame(e.inputFrame), 16000);
          }
        },
      };
      const sink = this.sink;
      await WebVoiceProcessor.subscribe(sink);
      if (this.stopped) {
        await WebVoiceProcessor.unsubscribe(sink);
        return;
      }
      this.onStatus("ok");
    } catch (err) {
      if (this.stopped) return;
      console.error("[opendex] vosk wake init failed", err);
      this.onLoading?.(false);
      this.onStatus("error");
      await this.dispose();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.audio.clear();
    if (this.sink) {
      try {
        await WebVoiceProcessor.unsubscribe(this.sink);
      } catch {
        // ignore
      }
      this.sink = null;
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    try {
      this.rec?.remove();
    } catch {
      // ignore
    }
    this.rec = null;
  }
}
