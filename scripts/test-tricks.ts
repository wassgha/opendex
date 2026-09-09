import { strict as assert } from "node:assert";
import { test } from "node:test";
import { eligibleTricks, TrickPicker, TRICKS } from "../src/skills/tricks/catalog";
import { tricksSkill } from "../src/skills/tricks/skill";
import { DEFAULT_CONFIG } from "../src/main/config/schema";

const all = { skills: ["tricks", "clock", "weather", "open", "computer"], platform: "darwin", canControl: true, canCapture: true };

test("the first surprise is visual and a full cycle never repeats a trick", () => {
  const picker = new TrickPicker(() => 0);
  const choices = eligibleTricks(all);
  const cycle = choices.map(() => picker.choose(choices)!.id);
  assert.equal(cycle[0], "gravity-playground");
  assert.equal(new Set(cycle).size, choices.length);
  assert.notEqual(picker.choose(choices)!.id, cycle.at(-1));
});

test("missing skills, operating-system capabilities and permissions remove ineligible recipes", () => {
  assert.deepEqual(eligibleTricks({ ...all, skills: ["tricks"] }).map(t => t.id), ["gravity-playground"]);
  assert.equal(eligibleTricks({ ...all, canControl: false }).some(t => t.requires.includes("computer")), false);
  assert.equal(eligibleTricks({ ...all, canCapture: false }).some(t => t.id === "screen-detective"), false);
  assert.equal(eligibleTricks({ ...all, platform: "linux" }).some(t => t.id === "window-boomerang"), false);
  assert.equal(eligibleTricks({ ...all, skills: ["tricks", "clock"] }).some(t => t.id === "world-weather"), false);
});

test("a requested unavailable trick never silently becomes a different trick", () => {
  const picker = new TrickPicker();
  assert.equal(picker.choose(eligibleTricks({ ...all, skills: ["clock"] }), "window-boomerang"), undefined);
  assert.equal(picker.choose([], undefined), undefined);
  const single = [TRICKS[0]];
  assert.equal(picker.choose(single)?.id, picker.choose(single)?.id);
});

test("listing has no side effects and choosing returns a plan instead of false completion", async () => {
  const context = { config: DEFAULT_CONFIG, platform: "linux" as const, availableSkillIds: ["tricks", "clock"] };
  const list = await tricksSkill.tools[0].execute({} as never, context) as { tricks: { id: string }[] };
  assert.deepEqual(list.tricks.map(t => t.id), ["gravity-playground", "date-line"]);
  const result = await tricksSkill.tools[1].execute({ id: "date-line" } as never, context) as { status: string; steps: unknown[]; next: string };
  assert.equal(result.status, "selected_not_performed");
  assert.equal(result.steps.length, 2);
  assert.match(result.next, /Stop on error, denial, or interruption/);
  const missing = await tricksSkill.tools[1].execute({ id: "window-boomerang" } as never, context) as { error?: string };
  assert.ok(missing.error);
});


test("automatic choices separate similar world-fact demos when another unseen option exists", () => {
  const picker = new TrickPicker(() => 0);
  const choices = eligibleTricks(all);
  picker.choose(choices, "world-weather");
  const next = picker.choose(choices)!;
  assert.notEqual(next.family, "world-facts");
  // An explicit request still wins over variety preferences.
  assert.equal(picker.choose(choices, "date-line")?.id, "date-line");
});
