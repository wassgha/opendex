// Generates an AI code review for a PR from its diff against the base branch.
// Usage: `pnpm tsx scripts/review-pr.ts <base-ref> [head-ref]`
// Writes markdown to stdout. Requires AI_GATEWAY_API_KEY.
import { config as loadEnv } from "dotenv";
import { generateText } from "ai";
import { execSync } from "node:child_process";

loadEnv();

const base = process.argv[2];
const head = process.argv[3] ?? "HEAD";
const model = process.env.PR_REVIEW_MODEL ?? "anthropic/claude-sonnet-4-6";

// Keep the prompt bounded — a giant diff blows the context window and the model
// reviews the forest, not the trees. Truncated diffs still get a useful pass.
const MAX_DIFF_CHARS = 120_000;

if (!base) {
  console.error("Usage: tsx scripts/review-pr.ts <base-ref> [head-ref]");
  process.exit(1);
}

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("[pr-review] AI_GATEWAY_API_KEY not set");
  process.exit(1);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

async function main() {
  // Three-dot diff = changes on head since it diverged from base (ignores base's
  // own new commits), matching what GitHub shows in the PR "Files changed" tab.
  const range = `${base}...${head}`;
  // Exclude generated/vendored files that add noise without needing review.
  const exclude = "':!pnpm-lock.yaml' ':!*.lock' ':!dist/**' ':!out/**'";

  const diffStat = sh(`git diff ${range} --stat -- . ${exclude}`);
  let diff = sh(`git diff ${range} -- . ${exclude}`);

  if (!diff) {
    process.stdout.write("_No reviewable changes in this PR._\n");
    return;
  }

  let truncatedNote = "";
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncatedNote =
      "\n\n> Note: the diff was truncated for review. Larger changes may need a manual pass.";
  }

  const { text } = await generateText({
    model,
    system: `You are a senior engineer reviewing a pull request for OpenDex, a voice-first Electron desktop agent (main process = Node, renderer = React; secrets never reach the renderer).
Give a focused, high-signal review. Skip nitpicks and praise.
Format markdown with:
## Summary (1-2 sentences on what the PR does)
## Findings (bullets; prefix each with a severity tag: [blocker], [warning], or [nit], and cite the file/area). Cover correctness, security (esp. secrets crossing the process boundary), IPC contract mismatches, error handling, and cross-platform concerns.
## Questions (optional; anything genuinely unclear)
If the change looks solid, say so briefly instead of inventing problems. No preamble.`,
    prompt: `Review this pull request.

Files changed:
${diffStat || "(none)"}

Diff (${base}...${head}):
\`\`\`diff
${diff}
\`\`\``,
  });

  process.stdout.write(`${text.trim()}${truncatedNote}\n`);
}

main().catch((err) => {
  console.error("[pr-review] error:", err);
  process.exit(1);
});
