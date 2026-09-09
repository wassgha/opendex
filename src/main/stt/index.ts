import { recordLatency } from "../diagnostics/latency-summary";
import type { SttProvider } from "../config/schema";
import { transcribeOpenAI } from "./openai";

// Provider switch for cloud transcription. Web Speech is handled entirely in
// the renderer and never reaches here. New cloud providers (Deepgram, etc.)
// slot in alongside OpenAI.
export async function transcribe(
  provider: SttProvider,
  wav: Buffer,
): Promise<string> {
  switch (provider) {
    case "openai":
      {
        const start = performance.now();
        const text = await transcribeOpenAI(wav);
        recordLatency("cloud-transcription", performance.now() - start);
        return text;
      }
    default:
      throw new Error(`Provider "${provider}" is not a cloud STT provider.`);
  }
}
