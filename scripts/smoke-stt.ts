// Smoke test for the main-process OpenAI transcription. Reads a WAV path (arg
// or /tmp/cmd.wav) and prints the transcript. Reports gracefully if
// OPENAI_API_KEY is unset. Usage: pnpm tsx scripts/smoke-stt.ts [file.wav]
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { transcribeOpenAI } from "../src/main/stt/openai";

loadEnv();

async function main() {
  const path = process.argv[2] ?? "/tmp/cmd.wav";
  const wav = readFileSync(path);
  process.stdout.write(`[smoke-stt] transcribing ${path} (${wav.length} bytes)\n`);
  if (!process.env.OPENAI_API_KEY) {
    process.stdout.write("[smoke-stt] OPENAI_API_KEY unset — verifying error path only.\n");
    try {
      await transcribeOpenAI(wav);
    } catch (err) {
      process.stdout.write(`[smoke-stt] expected error: ${(err as Error).message}\n`);
      return;
    }
    return;
  }
  const text = await transcribeOpenAI(wav);
  process.stdout.write(`[smoke-stt] transcript: "${text}"\n`);
}

main().catch((err) => {
  console.error("[smoke-stt] error", err);
  process.exit(1);
});
