// Transcribe a WAV buffer via the OpenAI audio transcription API. Runs in the
// main process so the API key never reaches the renderer.

export async function transcribeOpenAI(wav: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const model = process.env.OPENDEX_STT_MODEL ?? "gpt-4o-transcribe";
  const form = new FormData();
  // Node 18+/Electron provides global Blob + FormData + fetch.
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "command.wav",
  );
  form.append("model", model);
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI transcription failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  // response_format=text returns a plain string body.
  return (await res.text()).trim();
}
