// Wake/STT engine contracts. Web Speech and the keyless "manual" path stay
// inline in use-dex (they're tightly coupled to the state machine); Porcupine
// wake and cloud STT are encapsulated here behind these interfaces.

export type EngineStatus = "ok" | "needs-key" | "unsupported" | "error";

export interface WakeEngine {
  /** Begin listening for the wake trigger; `onWake` fires on detection. */
  start(onWake: () => void): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CaptureOptions {
  /** End the utterance after this much trailing silence. */
  silenceMs: number;
  /** Absolute cap on capture length. */
  hardTimeoutMs: number;
  signal?: AbortSignal;
}

export interface SttEngine {
  /** Capture one utterance and resolve its transcript ("" if nothing heard). */
  capture(opts: CaptureOptions): Promise<string>;
  dispose(): void;
}
