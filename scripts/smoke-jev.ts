// Smoke-test the Jev desktop router without Electron.
// Usage:
//   pnpm smoke:jev                  # local extractors only
//   pnpm smoke:jev --live           # also hit Gateway evaluate (needs AI_GATEWAY_API_KEY)
import { config as loadEnv } from "dotenv";
import {
  extractOpenTarget,
  routeDesktopIntent,
  type DesktopRoute,
} from "../src/main/agent/jev/desktop-route";

loadEnv();

const cases: Array<{ text: string; route: DesktopRoute; expect: string | null }> = [
  { text: "open Safari", route: "open_app", expect: "Safari" },
  { text: "please launch Slack", route: "open_app", expect: "Slack" },
  { text: "can you open the Notes app", route: "open_app", expect: "Notes" },
  { text: "open https://example.com/foo", route: "open_url", expect: "https://example.com/foo" },
  { text: "go to github.com", route: "open_url", expect: "https://github.com" },
  { text: "open ~/Documents", route: "open_path", expect: "~/Documents" },
  { text: "open Chrome and click the first tab", route: "open_app", expect: null },
];

async function main() {
  let failed = 0;
  console.log("[smoke:jev] extractor checks");
  for (const c of cases) {
    if (c.route !== "open_app" && c.route !== "open_url" && c.route !== "open_path") continue;
    const got = extractOpenTarget(c.text, c.route);
    const value =
      got?.kind === "app" ? got.name : got?.kind === "url" ? got.url : got?.kind === "path" ? got.path : null;
    const ok = value === c.expect;
    console.log(`  ${ok ? "ok" : "FAIL"}  "${c.text}" → ${JSON.stringify(value)}`);
    if (!ok) failed++;
  }

  if (process.argv.includes("--live")) {
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.error("[smoke:jev] --live needs AI_GATEWAY_API_KEY");
      process.exit(1);
    }
    const samples = [
      "open Safari",
      "click the blue Submit button",
      "what's the weather in SF",
      "go to github.com",
    ];
    console.log("[smoke:jev] live Jev routes");
    for (const text of samples) {
      const t0 = Date.now();
      const routed = await routeDesktopIntent(text);
      console.log(
        `  "${text}" → ${routed ? `${routed.route} p=${routed.probability.toFixed(2)} (${routed.latencyMs}ms)` : "null"} (wall ${Date.now() - t0}ms)`,
      );
    }
  }

  if (failed) {
    console.error(`[smoke:jev] FAIL: ${failed} extractor case(s)`);
    process.exit(1);
  }
  console.log("[smoke:jev] ok");
}

main().catch((err) => {
  console.error("[smoke:jev] error", err);
  process.exit(1);
});
