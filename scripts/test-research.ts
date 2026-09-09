import { strict as assert } from "node:assert";
import { test } from "node:test";
import { researchSchema, type ResearchUpdate } from "../src/skills/research/schema";
import { researchSkill } from "../src/skills/research/skill";
import { ResearchMilestones, delegatedReport } from "../src/renderer/src/lib/dex/research-progress";
import { researchStepLimit } from "../src/main/agent/research-budget";
import { ResponseCoordinator } from "../src/main/agent/realtime/response-coordinator";

const snapshot = (): ResearchUpdate => ({
  topic: "Compare energy data", stage: "reading", milestone: "finding",
  plan: [{ title: "Find original measurements", status: "done" }, { title: "Compare definitions and dates", status: "active" }],
  update: "The two reports measure different periods, so their totals cannot yet be compared.",
  sources: [{ title: "Original report", url: "https://example.org/report", status: "read", note: "Monthly measurements, not annual totals." }],
  findings: [{ text: "The report covers one month.", sourceUrls: ["https://example.org/report"] }], openQuestions: ["Find matching annual figures."],
});
test("research findings require read sources and completed research requires a finished plan", async () => {
  assert.equal(researchSchema.safeParse(snapshot()).success, true);
  const unread = snapshot(); unread.sources[0].status = "found";
  assert.equal(researchSchema.safeParse(unread).success, false);
  const fabricated = snapshot(); fabricated.findings[0].sourceUrls = ["https://example.org/missing"];
  assert.equal(researchSchema.safeParse(fabricated).success, false);
  const unfinished = snapshot(); unfinished.stage = "complete";
  assert.equal(researchSchema.safeParse(unfinished).success, false);
  const complete = snapshot(); complete.stage = "complete"; complete.plan.forEach(s => s.status = "done");
  assert.equal(researchSchema.safeParse(complete).success, true);
  const output = await researchSkill.tools[0].execute(complete as never) as ResearchUpdate;
  assert.deepEqual(output.sources, complete.sources);
  const unsafe = snapshot(); unsafe.sources[0].url = "javascript:alert(1)";
  assert.equal(researchSchema.safeParse(unsafe).success, false);
  unsafe.sources[0].url = "not a URL";
  assert.equal(researchSchema.safeParse(unsafe).success, false);
});
test("only substantive milestones speak, with no overlap, repetition, or completion recap", () => {
  const m = new ResearchMilestones(); const update = snapshot();
  assert.equal(m.next({ ...update, milestone: "plan" }, 0, false), undefined);
  assert.equal(m.next(update, 1, true), undefined);
  assert.equal(m.next(update, 2, false), update.update);
  assert.equal(m.next(update, 20000, false), undefined);
  const changed = { ...update, update: "A primary dataset resolves the mismatch." };
  assert.equal(m.next(changed, 10000, false), undefined);
  assert.equal(m.next(changed, 20000, false), changed.update);
  assert.equal(m.next({ ...update, stage: "complete" }, 40000, false), undefined);
});
test("a final report excludes earlier plans and never promotes a tool-limit ending to completion", () => {
  assert.equal(delegatedReport([
    { role: "assistant", content: "I'll search several sources." },
    { role: "assistant", content: "The evidence supports option B." },
  ], "plan and final mixed together"), "The evidence supports option B.");
  assert.match(delegatedReport([{ role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "openUrl", input: {} }] }], "I will research"), /Do not claim completion/);
  assert.equal(delegatedReport([], "A provider error occurred."), "A provider error occurred.");
});
test("extra browser steps are reserved for an explicit research workflow", () => {
  assert.equal(researchStepLimit([{ toolCalls: [{ toolName: "openUrl" }] }]), 40);
  assert.equal(researchStepLimit([{ toolCalls: [{ toolName: "updateResearch" }] }]), 96);
});
test("research progress can speak during a pending task, then its final result waits for narration", () => {
  const spoken: Array<string | undefined> = [];
  const c = new ResponseCoordinator(text => spoken.push(text));
  c.created("initial"); c.toolStarted("research");
  c.reportProgress("research", "First finding"); assert.equal(spoken.length, 0);
  c.done("initial"); assert.deepEqual(spoken, ["First finding"]);
  c.created("milestone"); c.toolFinished("research"); assert.equal(spoken.length, 1);
  c.done("milestone"); assert.deepEqual(spoken, ["First finding", undefined]);
});
test("interruptions discard pending milestones and stale workers cannot restart narration", () => {
  const spoken: Array<string | undefined> = [];
  const c = new ResponseCoordinator(text => spoken.push(text));
  c.created("initial"); c.toolStarted("research"); c.reportProgress("research", "Obsolete finding");
  c.speechStarted(); c.done("initial"); c.speechStopped();
  c.reportProgress("research", "Late finding"); c.created("user"); c.done("user");
  assert.deepEqual(spoken, []);
  c.close(); c.reportProgress("research", "After close"); assert.deepEqual(spoken, []);
});
test("finishing a task replaces its queued milestone with the final result", () => {
  const spoken: Array<string | undefined> = [];
  const c = new ResponseCoordinator(text => spoken.push(text));
  c.created("initial"); c.toolStarted("research"); c.reportProgress("research", "About to finish");
  c.toolFinished("research"); c.done("initial");
  assert.deepEqual(spoken, [undefined]);
});
