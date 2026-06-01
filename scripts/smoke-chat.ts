// Standalone smoke test for the main-process agent — runs streamChat without
// Electron and prints the streamed deltas. Usage: `pnpm smoke:chat [briefing]`
import { config as loadEnv } from "dotenv";
import { streamChat } from "../src/main/agent/chat";

loadEnv();

async function main() {
  const briefing = process.argv.includes("briefing");
  const messages = briefing
    ? [{ role: "user" as const, content: "Give me my morning briefing." }]
    : [{ role: "user" as const, content: "Say hello in one short sentence." }];

  let chars = 0;
  process.stdout.write(`\n[smoke] mode=${briefing ? "briefing" : "chat"}\n---\n`);
  for await (const delta of streamChat({ messages, mode: briefing ? "briefing" : undefined })) {
    process.stdout.write(delta);
    chars += delta.length;
  }
  process.stdout.write(`\n---\n[smoke] received ${chars} chars\n`);
  if (chars === 0) {
    console.error("[smoke] FAIL: no output");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke] error", err);
  process.exit(1);
});
