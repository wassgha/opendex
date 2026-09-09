import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clockSkill } from "../src/skills/clock/skill";

const run = clockSkill.tools[0].execute as (input: { timezone?: string }) => Promise<{ timezone?: string; iso?: string; error?: string }>;
test("time requests without a location use the computer timezone", async () => {
  assert.equal((await run({})).timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal((await run({ timezone: "" })).timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});
test("explicit foreign timezones still work and invalid zones return an error", async () => {
  assert.equal((await run({ timezone: "Europe/London" })).timezone, "Europe/London");
  assert.ok((await run({ timezone: "not-a-zone" })).error);
});
