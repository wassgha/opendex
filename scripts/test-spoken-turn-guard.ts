import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SpokenTurnGuard } from "../src/main/agent/realtime/spoken-turn-guard";

type Event = { responseId: string; type: string };
function setup(timeout = 5000) {
  const output: Event[] = [];
  let rejected = 0;
  const guard = new SpokenTurnGuard<Event>(event => output.push(event), () => rejected++, timeout);
  return { guard, output, rejected: () => rejected };
}
test("untranscribed speech cannot play audio, display captions, or execute tools", async () => {
  const s = setup(10);
  s.guard.speechStarted("noise"); s.guard.speechStopped("noise");
  s.guard.responseCreated("invented", false);
  for (const type of ["audio-delta", "text-delta", "function-call-arguments-done", "response-done"]) {
    s.guard.output({ responseId: "invented", type });
  }
  assert.deepEqual(s.output, []);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.rejected(), 1);
  s.guard.transcript("noise", "late");
  assert.deepEqual(s.output, []);
});
test("a delayed valid transcript releases buffered reply events once and in order", () => {
  const s = setup();
  s.guard.speechStarted("speech"); s.guard.speechStopped("speech");
  s.guard.responseCreated("answer", false);
  s.guard.output({ responseId: "answer", type: "audio-delta" });
  s.guard.output({ responseId: "answer", type: "response-done" });
  assert.equal(s.output.length, 0);
  s.guard.transcript("speech", "What time is it?");
  s.guard.transcript("speech", "duplicate");
  assert.deepEqual(s.output.map(e => e.type), ["audio-delta", "response-done"]);
  s.guard.close();
});
test("new speech cannot be authorized by the previous turn's delayed transcript", () => {
  const s = setup();
  s.guard.speechStarted("old"); s.guard.speechStopped("old");
  s.guard.responseCreated("old-response", false);
  s.guard.speechStarted("new"); s.guard.speechStopped("new");
  s.guard.responseCreated("new-response", false);
  s.guard.transcript("old", "old request");
  s.guard.output({ responseId: "new-response", type: "audio-delta" });
  s.guard.output({ responseId: "old-response", type: "audio-delta" });
  assert.equal(s.output.length, 0);
  s.guard.transcript("new", "new request");
  assert.deepEqual(s.output.map(e => e.responseId), ["new-response"]);
  s.guard.close();
});
test("empty transcription closes quietly; teardown cancels the timeout", async () => {
  const s = setup(10);
  s.guard.speechStarted("empty"); s.guard.speechStopped("empty");
  s.guard.transcript("empty", "  ");
  assert.equal(s.rejected(), 1);
  const closed = setup(10);
  closed.guard.speechStarted("speech"); closed.guard.speechStopped("speech");
  closed.guard.close();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(closed.rejected(), 0);
});
test("typed input supersedes a pending noise turn without waiting for transcription", async () => {
  const s = setup(10);
  s.guard.speechStarted("noise"); s.guard.speechStopped("noise");
  s.guard.userText(); s.guard.responseCreated("typed", true);
  s.guard.output({ responseId: "typed", type: "audio-delta" });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.output.length, 1); assert.equal(s.rejected(), 0);
  s.guard.close();
});
test("transcription before response creation and explicit tool continuations stream normally", () => {
  const s = setup();
  s.guard.speechStarted("speech"); s.guard.transcript("speech", "hello");
  s.guard.speechStopped("speech"); s.guard.responseCreated("answer", false);
  s.guard.output({ responseId: "answer", type: "audio-delta" });
  s.guard.responseCreated("tool-result", true);
  s.guard.output({ responseId: "tool-result", type: "audio-delta" });
  assert.equal(s.output.length, 2); s.guard.close();
});
