// Standalone smoke test for the main-process agent — runs streamChat without
// Electron and prints the streamed deltas. Usage: `pnpm smoke:chat [briefing]`
import { config as loadEnv } from "dotenv";
import { streamChat } from "../src/main/agent/chat";
import { buildSystemPrompt } from "../src/main/agent/system-prompt";
import { DEFAULT_CONFIG } from "../src/main/config/schema";

loadEnv();

async function main() {
  const briefing = process.argv.includes("briefing");
  const messages = briefing
    ? [{ role: "user" as const, content: "Give me my briefing." }]
    : [{ role: "user" as const, content: "Say hello in one short sentence." }];

  const system = buildSystemPrompt({ config: DEFAULT_CONFIG, briefing });
  const model = process.env.OPENDEX_MODEL ?? DEFAULT_CONFIG.llm.model;

  let chars = 0;
  process.stdout.write(`\n[smoke] mode=${briefing ? "briefing" : "chat"}\n---\n`);
  for await (const delta of streamChat({ messages, system, model, briefing })) {
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
