import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_CONFIG, mergeConfig, type PublicConfig } from "../src/main/config/schema";
import { diagnosticRuntime, observeDiagnosticSession } from "../src/main/diagnostics/runtime";
import type { SessionState } from "../src/main/ipc/channels";
import { meta as diagnosticMeta } from "../src/skills/diagnostics/meta";
import { localAgentsSkill } from "../src/skills/local-agents/skill";
import { isSkillAvailable } from "../src/skills/availability";
import { isDirectTool } from "../src/skills/realtime-selection";

const config: PublicConfig = { config: DEFAULT_CONFIG, encryptionAvailable: true,
  secrets: { AI_GATEWAY_API_KEY: false, ANTHROPIC_API_KEY: false, OPENAI_API_KEY: false, XAI_API_KEY: false, TAVILY_API_KEY: false, ELEVENLABS_API_KEY: false } };

test("only active voice-path credentials are required; realtime retains delegated model checks", () => {
  const realtime = diagnosticRuntime({ ...config, config: mergeConfig(DEFAULT_CONFIG, { voice: { mode: "realtime" } }) });
  assert.equal(realtime.checks.find(c => c.id === "realtime-credential")?.state, "missing");
  assert.ok(realtime.checks.some(c => c.id === "language-model-credential"));
  assert.ok(!realtime.checks.some(c => c.id === "speech-output-credential"));
  const pipeline = diagnosticRuntime({ ...config, config: mergeConfig(DEFAULT_CONFIG, { voice: { mode: "pipeline" }, tts: { engine: "system" }, voiceInput: { sttProvider: "vosk-local" } }) });
  assert.deepEqual(pipeline.checks.map(c => c.id), ["language-model-credential"]);
});

test("direct OpenAI realtime readiness uses the OpenAI key independently of Gateway", () => {
  const direct = { ...config, config: mergeConfig(DEFAULT_CONFIG, { voice: { mode: "realtime" }, realtime: { provider: "openai" } }) };
  const missing = diagnosticRuntime({ ...direct, secrets: { ...config.secrets, AI_GATEWAY_API_KEY: true } });
  assert.equal(missing.checks.find(c => c.id === "realtime-credential")?.state, "missing");
  const ready = diagnosticRuntime({ ...direct, secrets: { ...config.secrets, OPENAI_API_KEY: true } });
  assert.equal(ready.checks.find(c => c.id === "realtime-credential")?.state, "ready");
  assert.ok(!ready.checks.some(c => c.state === "unsupported"));
});

test("private config and renderer captions cannot enter runtime reports", () => {
  const observed = { status: "speaking", muted: true, activity: [], toolInvocations: [], liveCaption: "PRIVATE", spokenCaption: "PRIVATE", reply: "PRIVATE" } as SessionState;
  observeDiagnosticSession(observed, 100);
  const result = diagnosticRuntime({ ...config, config: mergeConfig(DEFAULT_CONFIG, { assistant: { persona: "PRIVATE" }, llm: { model: "PRIVATE" } }) }, 150);
  assert.equal(result.session?.ageMs, 50);
  assert.equal(result.session?.status, "speaking");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  observeDiagnosticSession({ ...observed, status: "PRIVATE" }, 200);
  assert.equal(diagnosticRuntime(config).session?.status, "unknown");
});

test("inspection skills are opt-in and permission-gated; discovery is direct in realtime", () => {
  assert.equal(diagnosticMeta.optIn, true); assert.equal(diagnosticMeta.sensitive, true);
  assert.equal(localAgentsSkill.optIn, true); assert.equal(localAgentsSkill.sensitive, true);
  assert.equal(isSkillAvailable(localAgentsSkill, DEFAULT_CONFIG), false);
  assert.equal(isSkillAvailable(localAgentsSkill, mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { "local-agents": true } } })), true);
  assert.ok(localAgentsSkill.tools.every(t => isDirectTool(t, localAgentsSkill)));
});
