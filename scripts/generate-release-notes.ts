// Generates GitHub release notes from the git range since the previous tag.
// Usage: `pnpm tsx scripts/generate-release-notes.ts <current-ref> [previous-ref]`
// Writes markdown to stdout. Requires AI_GATEWAY_API_KEY.
import { config as loadEnv } from "dotenv";
import { generateText } from "ai";
import { execSync } from "node:child_process";

loadEnv();

const current = process.argv[2];
const previous = process.argv[3];
const model = process.env.RELEASE_NOTES_MODEL ?? "anthropic/claude-sonnet-4-6";

if (!current) {
  console.error("Usage: tsx scripts/generate-release-notes.ts <current-ref> [previous-ref]");
  process.exit(1);
}

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("[release-notes] AI_GATEWAY_API_KEY not set");
  process.exit(1);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
}

function gatherContext(): { commits: string; diffStat: string; changedFiles: string } {
  const excludeLock = "-- . ':!pnpm-lock.yaml'";

  if (!previous) {
    return {
      commits: sh(`git log ${current} --pretty=format:%h %s -20`),
      diffStat: "(first release)",
      changedFiles: "",
    };
  }

  const range = `${previous}..${current}`;
  return {
    commits: sh(`git log ${range} --pretty=format:%h %s`),
    diffStat: sh(`git diff ${range} --stat ${excludeLock}`),
    changedFiles: sh(`git diff ${range} --name-only ${excludeLock}`),
  };
}

async function main() {
  const { commits, diffStat, changedFiles } = gatherContext();

  const { text } = await generateText({
    model,
    system: `You write GitHub release notes for OpenDex, a voice-first Electron desktop agent.
Audience: end users and contributors. Tone: clear, concise, no hype.
Format markdown with:
## Highlights (2-4 bullets of the most user-visible changes)
## Changes (bullets grouped by theme when helpful: Voice, Skills, UI/Themes, Settings, Fixes)
Omit internal refactors unless user-visible. No commit hashes. No preamble.`,
    prompt: previous
      ? `Release ${current} (changes since ${previous}):

Commits:
${commits || "(none)"}

Files changed:
${changedFiles || "(none)"}

Diff summary:
${diffStat || "(none)"}`
      : `Release ${current} (first tagged release):

Recent commits:
${commits || "(none)"}`,
  });

  process.stdout.write(`${text.trim()}\n`);
}

main().catch((err) => {
  console.error("[release-notes] error:", err);
  process.exit(1);
});
