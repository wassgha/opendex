import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export const maxDuration = 60;

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

export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "Missing 'text' field." }, { status: 400 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

  try {
    const stream = await client().textToSpeech.stream(voiceId, {
      text,
      modelId,
      outputFormat: "mp3_44100_128",
      optimizeStreamingLatency: 3,
    });

    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS request failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
