import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { capabilityInventory } from "../src/main/maintenance/capabilities";
import { startDexEnhancement, tuneDex } from "../src/main/maintenance/self-enhancement";
import { buildSystemPrompt, buildRealtimeInstructions } from "../src/main/agent/system-prompt";
import { buildToolSet } from "../src/skills/registry";
import { selfEnhancementSkill } from "../src/skills/self-enhancement/skill";

const input = { operationId: "49b4e83e-e3cb-48ab-a690-bae8028ddf84", request: "Help organize my notes", gap: "No persistent notes tool", acceptance: "Save and retrieve a note after restart" };
test("inventory distinguishes setup and access from absent capabilities", () => {
  const skills = ["disabled", "denied", "unavailable", "available"].map(id => ({ id, label: id, description: id, sensitive: true, optIn: true, isReady: () => id !== "unavailable", tools: [] }));
  const config = mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { denied: true, unavailable: true, available: true }, permissions: { denied: "never" } } });
  assert.deepEqual(capabilityInventory(skills, config).map(s => s.state), ["disabled", "denied", "unavailable", "available"]);
});
test("enhancement refuses installed or unverified source without dispatch", async () => {
  for (const source of [{ packaged: true, appPath: process.cwd() }, { packaged: false, appPath: "/missing-dex-source" }]) {
    const result = await startDexEnhancement(input, { source: async () => source, create: async () => { throw new Error("Must not dispatch"); } });
    assert.equal(result.state, "source-unavailable");
  }
});
test("verified source produces bounded implementation requirements and preserves receipt", async () => {
  const appPath = await mkdtemp(join(tmpdir(), "dex-enhance-"));
  try {
    await mkdir(join(appPath, "src/main"), { recursive: true });
    await writeFile(join(appPath, "package.json"), '{"name":"opendex"}');
    await writeFile(join(appPath, "src/main/index.ts"), "");
    const result = await startDexEnhancement(input, { source: async () => ({ packaged: false, appPath }), create: async request => {
      assert.equal(request.cwd, appPath);
      assert.equal(request.operationId, input.operationId);
      assert.match(request.prompt, /Save and retrieve a note after restart/);
      assert.match(request.prompt, /hypothesis: verify it before editing/);
      assert.match(request.prompt, /Do not restart the running app/);
      assert.match(request.prompt, /Preserve unrelated and ongoing work/);
      return { state: "unconfirmed", operationId: input.operationId };
    } });
    assert.equal(result.state, "unconfirmed");
  } finally { await rm(appPath, { recursive: true, force: true }); }
});
for (const [mode, build] of [["pipeline", buildSystemPrompt], ["realtime", buildRealtimeInstructions]] as const) {
  test(`${mode}: fallback survives greetings/custom personas and respects disabled/Never`, () => {
    for (const briefing of [false, true]) {
      const config = mergeConfig(DEFAULT_CONFIG, { assistant: { persona: "Be brief." } });
      assert.match(build({ config, briefing }), /Self-enhancement is disabled/);
      const enabled = mergeConfig(config, { skills: { enabled: { "self-enhancement": true } } });
      assert.match(build({ config: enabled, briefing }), /call startDexEnhancement when offered/);
      assert.match(build({ config: enabled, briefing }), /call tuneDex when offered/);
      const denied = mergeConfig(enabled, { skills: { permissions: { "self-enhancement": "never" } } });
      assert.match(build({ config: denied, briefing }), /Do not dispatch an implementation task/);
    }
  });
}
test("enhancement is opt-in and its execute path respects the permission gate", async () => {
  const original = selfEnhancementSkill.isReady;
  selfEnhancementSkill.isReady = () => true;
  try {
    assert.equal(buildToolSet({ config: DEFAULT_CONFIG, requestPermission: async () => true }).startDexEnhancement, undefined);
    assert.equal(buildToolSet({ config: DEFAULT_CONFIG, requestPermission: async () => true }).tuneDex, undefined);
    let requested = "";
    const tools = buildToolSet({ config: mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { "self-enhancement": true } } }), requestPermission: async id => { requested = id; return false; } });
    const result = await tools.startDexEnhancement.execute!(input, { toolCallId: "test", messages: [] });
    assert.deepEqual(await tools.tuneDex.execute!({ operationId: input.operationId }, { toolCallId: "tune", messages: [] }), { error: "Permission denied by the user." });
    assert.equal(requested, "self-enhancement");
    assert.deepEqual(result, { error: "Permission denied by the user." });
  } finally { selfEnhancementSkill.isReady = original; }
});

test("tune command dispatches one stable evidence-first pass without inventing a bottleneck", async () => {
  let calls = 0;
  const result = await tuneDex(input.operationId, {
    source: async () => ({ packaged: false, appPath: process.cwd() }),
    create: async request => {
      calls++;
      assert.equal(request.operationId, input.operationId);
      assert.match(request.prompt, /Run pnpm diagnose:latency first/);
      assert.match(request.prompt, /stop without speculative edits/);
      assert.match(request.prompt, /not conversation-bearing interaction logs/);
      assert.match(request.prompt, /implement only one focused optimization/);
      assert.match(request.prompt, /Do not restart the running app/);
      return { state: "unconfirmed", operationId: input.operationId };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.state, "unconfirmed");
});
