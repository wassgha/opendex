import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — deep British male

let cachedClient: ElevenLabsClient | null = null;
function client() {
  if (!cachedClient) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");
    cachedClient = new ElevenLabsClient({ apiKey });
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

  const stream = await client().textToSpeech.stream(voiceId, {
    text: trimmed,
    modelId,
    outputFormat: "mp3_44100_128",
    optimizeStreamingLatency: 3,
  });

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
