import { test } from "node:test";
import assert from "node:assert/strict";
import { controlAgentSession } from "../src/main/maintenance/session-control";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { buildSystemPrompt, buildRealtimeInstructions } from "../src/main/agent/system-prompt";
import { buildToolSet } from "../src/skills/registry";
import { buildRealtimeToolDefs } from "../src/main/agent/realtime/realtime-tools";
const taskId = "b96dc42d-cd8c-47ea-836a-9302a378a397";
const operationId = "6e609249-bce7-40d9-8352-b38a58f810ec";

test("unresolved target and missing revision cause no side effects", async () => {
  const fail = async () => { throw Error("must not execute"); };
  for (const action of ["update", "revise", "scrap"] as const) {
    assert.equal((await controlAgentSession({ action, operationId }, { send: fail, archive: fail })).state, "needs-target");
  }
  for (const action of ["update", "revise"] as const) {
    assert.equal((await controlAgentSession({ action, taskId, operationId }, { send: fail, archive: fail })).state, "needs-revision");
  }
});

test("update/revise preserve exact target, change, operation ID and failure receipts", async () => {
  for (const action of ["update", "revise"] as const) for (const state of ["accepted", "unconfirmed", "not-submitted"]) {
    let calls = 0;
    const result = await controlAgentSession({ action, taskId, operationId, prompt: "Use a blue header" }, {
      send: async input => { calls++; assert.deepEqual(input, { taskId, operationId, prompt: "Use a blue header" }); return { state, taskId, operationId }; },
      archive: async () => { throw Error("must not archive"); },
    });
    assert.equal(calls, 1); assert.equal(result.state, state);
  }
});

test("scrap preserves archive verification/rejection and supplies manual UI guidance without delegation", async () => {
  for (const state of ["archived", "rejected", "unconfirmed"]) {
    const result = await controlAgentSession({ action: "scrap", taskId, operationId }, {
      send: async () => { throw Error("must not send"); },
      archive: async input => { assert.deepEqual(input, { taskId, operationId }); return { state, taskId, operationId, failureKind: state === "rejected" ? "active-writer" : undefined }; },
    });
    assert.equal(result.state, state);
    assert.match("guidance" in result ? result.guidance : "", /owning Codex UI/);
    assert.equal("fallback" in result, false);
  }
  const failed = await controlAgentSession({ action: "scrap", taskId, operationId }, {
    send: async () => { throw Error(); }, archive: async () => { throw Error("private error"); },
  });
  assert.equal(failed.state, "unavailable"); assert.doesNotMatch(JSON.stringify(failed), /private error/);
});

test("both voice contexts explain target ambiguity, revision input and voice reset separation", () => {
  for (const build of [buildSystemPrompt, buildRealtimeInstructions]) for (const briefing of [false, true]) {
    const prompt = build({ config: DEFAULT_CONFIG, briefing, skillPrompts: [] });
    for (const text of ["update session", "revise session", "scrap session", "ask which session before any mutation", "ask what to update or revise", "not authorization"]) {
      if (text === "not authorization") assert.match(prompt, /Do not treat a request to stop listening/);
      else assert.ok(prompt.includes(text));
    }
  }
});

test("session control is opt-in, permission gated and direct in realtime", async () => {
  const name = "controlLocalAgentSession";
  assert.equal(name in buildToolSet({ config: DEFAULT_CONFIG, requestPermission: async () => true }), false);
  const config = mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { "local-agent-actions": true } } });
  let prompts = 0;
  const tool = buildToolSet({ config, requestPermission: async skill => { prompts++; assert.equal(skill, "local-agent-actions"); return false; } })[name];
  const result = await tool.execute!({ action: "scrap", taskId, operationId }, { toolCallId: "test", messages: [] });
  assert.equal(prompts, 1); assert.match(JSON.stringify(result), /denied/i);
  assert.ok(buildRealtimeToolDefs(config).some(t => t.name === name));
});
