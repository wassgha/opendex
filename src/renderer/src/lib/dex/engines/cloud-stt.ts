import type { SttProvider } from "../../../../../main/config/schema";
import type { CaptureOptions, SttEngine } from "./types";
import { captureUtterance } from "./frame-capture";
import { encodeWav } from "./wav";

/**
 * Cloud STT: captures one utterance from the mic, encodes WAV, and sends it to
 * the main process for transcription (the API key stays in main).
 */
export class CloudSttEngine implements SttEngine {
  constructor(private readonly provider: SttProvider) {}

  capture(opts: CaptureOptions): Promise<string> {
    return captureUtterance(opts, async (frames) => {
      const wav = encodeWav(frames);
      return window.opendex.transcribe(this.provider, wav);
    });
  }

  dispose(): void {}
}
