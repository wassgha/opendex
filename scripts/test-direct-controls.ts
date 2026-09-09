import { strict as assert } from "node:assert";
import { test } from "node:test";
import { z } from "zod";
import { directSkill, isDirectTool } from "../src/skills/realtime-selection";
import { taskProgress } from "../src/renderer/src/lib/task-progress";
import { inputTranscript, type TranscriptTurn } from "../src/renderer/src/lib/dex/state";
import type { Skill } from "../src/skills/types";
import type { SessionToolInvocation } from "../src/main/ipc/channels";

test("a simple voice exchange keeps input in place without flashing progress rows", () => {
  const turns: TranscriptTurn[] = [];
  assert.equal(taskProgress("thinking", []), null, "connection/wake preparation is not task progress");
  assert.equal(inputTranscript(turns, "are you"), "are you");
  assert.equal(taskProgress("active_listening", []), null);
  turns.push({ id: "input", role: "user", content: "Are you there?" });
  assert.equal(inputTranscript(turns, ""), "Are you there?");
  assert.equal(taskProgress("thinking", []), null, "confirmation must not reinsert a preparing row");
  turns.push({ id: "reply", role: "assistant", content: "I'm here." });
  for (const status of ["thinking", "speaking", "follow_up_listening"]) {
    assert.equal(taskProgress(status, []), null);
    assert.equal(inputTranscript(turns, ""), "Are you there?");
  }
});

test("only explicitly direct computer controls reach realtime; permission identity is retained", () => {
  const tool = { description: "test", inputSchema: z.object({}), execute: async () => ({ ok: true }) };
  const skill: Skill = { id: "computer", label: "Computer", description: "test", sensitive: true, optIn: true, imageResults: true, systemPrompt: "Capture first", tools: [
    { ...tool, name: "captureScreen" }, { ...tool, name: "pressKeys" }, { ...tool, name: "controlDesktop", realtime: true }, { ...tool, name: "describeScreen", realtime: true },
  ] };
  const projected = directSkill(skill);
  assert.deepEqual(projected.tools.map((t) => t.name), ["controlDesktop", "describeScreen"]);
  assert.equal(projected.id, "computer");
  assert.equal(projected.sensitive, true);
  assert.equal(projected.optIn, true);
  assert.equal(projected.systemPrompt, undefined);
  assert.equal(isDirectTool(skill.tools[0], skill), false);
});

const invocation = (name: string, status: SessionToolInvocation["status"]): SessionToolInvocation => ({ id: name, name, status, input: {}, result: null });
test("progress follows actual actions and remains visible between desktop steps", () => {
  const task = invocation("run_task", "running");
  assert.equal(taskProgress("thinking", [task, invocation("captureScreen", "running")])?.label, "Reading the screen");
  assert.deepEqual(taskProgress("speaking", [task, invocation("captureScreen", "done")]), { label: "Waiting for the task agent", completed: 1 });
  assert.equal(taskProgress("thinking", [task, invocation("pressKeys", "running")])?.label, "Pressing a shortcut");
  assert.equal(taskProgress("active_listening", [invocation("run_task", "done")]), null);
  assert.equal(taskProgress("muted", [task]), null);
  assert.equal(taskProgress("listening_wake", [task]), null);
});
