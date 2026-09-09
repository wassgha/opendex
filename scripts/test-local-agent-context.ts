import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { buildSystemPrompt, buildRealtimeInstructions } from "../src/main/agent/system-prompt";
import { localAgentsSkill } from "../src/skills/local-agents/skill";

for (const [mode, build] of [["pipeline", buildSystemPrompt], ["realtime", buildRealtimeInstructions]] as const) {
  test(`${mode}: local-task meaning and disabled access survive absent skill manuals and custom persona`, () => {
    const config = mergeConfig(DEFAULT_CONFIG, { assistant: { persona: "Speak concisely." } });
    for (const briefing of [false, true]) {
      const prompt = build({ config, briefing, skillPrompts: [] });
      assert.match(prompt, /what's Codex working on\?/);
      assert.match(prompt, /interpret this as their local Codex\/ChatGPT desktop tasks/);
      assert.match(prompt, /discovery is disabled/);
      assert.match(prompt, /Skills & tools, Local coding agents/);
      assert.doesNotMatch(prompt, /call listLocalAgents/);
      assert.match(prompt, /Explicit questions about OpenAI product news/);
    }
  });
  test(`${mode}: enabled discovery uses real evidence and treats Never as a denial`, () => {
    const enabled = mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { "local-agents": true } } });
    const ready = build({ config: enabled, briefing: false, skillPrompts: [localAgentsSkill.systemPrompt!] });
    assert.match(ready, /call listLocalAgents when offered/);
    assert.match(ready, /could not connect to the local Codex agent server/);
    assert.match(ready, /Creating tasks, opening tasks, and sending follow-ups require the separately enabled Local agent actions skill/);
    const denied = build({ config: mergeConfig(enabled, { skills: { permissions: { "local-agents": "never" } } }), briefing: false });
    assert.match(denied, /permission is set to Never/);
    assert.doesNotMatch(denied, /call listLocalAgents/);
    assert.match(denied, /Do not call the discovery tool or work around the denial/);
  });
}
