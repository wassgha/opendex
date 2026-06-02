// Minimal ambient types for vosk-browser (the package ships .d.ts files but
// doesn't declare a `types` entry, so TS can't resolve them automatically).
declare module "vosk-browser" {
  export interface VoskResultMessage {
    result?: { text?: string };
  }
  export interface VoskPartialMessage {
    result?: { partial?: string };
  }
  export interface KaldiRecognizer {
    id: string;
    on(event: "result", listener: (m: VoskResultMessage) => void): void;
    on(event: "partialresult", listener: (m: VoskPartialMessage) => void): void;
    on(event: string, listener: (m: unknown) => void): void;
    setWords(words: boolean): void;
    acceptWaveform(buffer: AudioBuffer): void;
    acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void;
    retrieveFinalResult(): void;
    remove(): void;
  }
  export class Model {
    constructor(modelUrl: string, logLevel?: number);
    on(event: string, listener: (m: unknown) => void): void;
    terminate(): void;
    get KaldiRecognizer(): { new (sampleRate: number, grammar?: string): KaldiRecognizer };
  }
  export function createModel(modelUrl: string, logLevel?: number): Promise<Model>;
}
