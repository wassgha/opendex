import { recordLatency } from "../diagnostics/latency-summary";
import { beginUsage, finishUsage } from "../usage/ledger";
import { unknownCharge, quantity } from "../usage/pricing";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — deep British male

let cachedClient: ElevenLabsClient | null = null;
let cachedKey: string | null = null;
function client() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");
  // Rebuild when the key changes (e.g. the user rotates it in Settings, which
  // updates process.env via applyToEnv) so credential changes take effect
  // without an app restart.
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new ElevenLabsClient({ apiKey });
    cachedKey = apiKey;
  }
  return cachedClient;
}

/**
 * Synthesise a sentence to MP3 bytes. Returns a Buffer the renderer wraps in a
 * Blob for playback. (Ported from the former app/api/tts/route.ts — we collect
 * the stream into a buffer because IPC can't forward a ReadableStream cleanly;
 * per-sentence clips are small, so the sentence-buffer latency win is kept.)
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Missing text for synthesis.");

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

  const tts = client();
  const usageId = beginUsage({ provider: "elevenlabs", model: modelId, category: "speech" });
  const start = performance.now();
  try {
    const { data: stream, rawResponse } = await tts.textToSpeech.stream(voiceId, {
      text: trimmed,
      modelId,
      outputFormat: "mp3_44100_128",
      optimizeStreamingLatency: 3,
    }).withRawResponse();

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    finishUsage(usageId, { characters: trimmed.length, credits: quantity(rawResponse.headers.get("character-cost") ?? undefined) }, unknownCharge("ElevenLabs credit usage depends on your plan and allowance. Dollar cost is unavailable."));
    const buffer = Buffer.concat(chunks);
    recordLatency("speech-synthesis", performance.now() - start);
    return buffer;
  } catch (error) {
    finishUsage(usageId, { characters: trimmed.length }, unknownCharge("Speech generation ended without final usage; charges may apply."), true);
    throw error;
  }
}
