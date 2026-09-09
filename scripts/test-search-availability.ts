import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { isSkillAvailable } from "../src/skills/availability";
import { webSearchSkill } from "../src/skills/web-search/skill";

test("search is advertised only when enabled and configured, including after key changes", () => {
  const previous = process.env.TAVILY_API_KEY;
  try {
    for (const key of [undefined, "", "   ", "test-key"]) {
      if (key === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = key;
      assert.equal(isSkillAvailable(webSearchSkill, DEFAULT_CONFIG), key === "test-key");
      assert.equal(isSkillAvailable(webSearchSkill, mergeConfig(DEFAULT_CONFIG, {
        skills: { enabled: { "web-search": false } },
      })), false);
    }
    delete process.env.TAVILY_API_KEY;
    assert.equal(isSkillAvailable(webSearchSkill, DEFAULT_CONFIG), false);
  } finally {
    if (previous === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous;
  }
});

test("a stale search call without a key returns browser recovery without contacting the service", async (t) => {
  const previous = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network request"); });
  try {
    const result = await webSearchSkill.tools[0].execute({ query: "latest news" } as never) as { error: string; recovery: string };
    assert.match(result.error, /access key is not configured/);
    assert.match(result.recovery, /run_task/);
    assert.match(result.recovery, /permission denials/);
  } finally {
    if (previous !== undefined) process.env.TAVILY_API_KEY = previous;
  }
});
