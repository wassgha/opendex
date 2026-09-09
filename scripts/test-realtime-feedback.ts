import { RealtimeNoticeBuffer } from "../src/main/agent/realtime/notice-buffer";
import { voiceErrorFeedback, isVoiceFailureFeedback } from "../src/renderer/src/lib/dex/realtime/voice-error";
import { strict as assert } from "node:assert";
import { test, type TestContext } from "node:test";
import { RealtimeVoiceSession, type RealtimeSessionCallbacks } from "../src/renderer/src/lib/dex/realtime/realtime-session";
import type { RealtimeServerNotice } from "../src/main/ipc/channels";

function fixture(t: TestContext) {
  const previous = globalThis.window;
  const feedback: string[] = [], disconnected: string[] = [], errors: string[] = [];
  let interruptions = 0, waits = 0, ends = 0;
  globalThis.window = { opendex: { realtimeSend: () => {}, realtimeEnd: () => ends++ } } as never;
  const callbacks: RealtimeSessionCallbacks = {
    onFeedbackChange: text => feedback.push(text), onVoiceError: text => errors.push(text),
    onWaitingForResponse: () => waits++, onUserSpeechStart: () => interruptions++,
    onUserTranscript: () => {}, onAssistantDelta: () => {}, onTurnDone: () => {},
    onSpeakingChange: () => {}, onToolCall: () => {}, onToolResult: () => {},
    onRunTask: () => {}, onDisconnect: reason => disconnected.push(reason), onAudioBlocked: () => {},
  };
  const session = new RealtimeVoiceSession({ micStream: {} as MediaStream, idleDisconnectSec: 60, callbacks });
  const notice = (value: RealtimeServerNotice) => (session as any).handleNotice(value);
  t.after(() => { session.close(); globalThis.window = previous; });
  return { session, notice, feedback, errors, disconnected, counts: () => ({ interruptions, waits, ends }) };
}

test("speech feedback precedes transcription without interrupting; confirmed turn immediately shows reply preparation", t => {
  const f = fixture(t);
  f.notice({ type: "input-state", state: "hearing" });
  assert.equal(f.feedback.at(-1), "Speech detected");
  assert.equal(f.counts().interruptions, 0);
  f.notice({ type: "input-state", state: "processing" });
  assert.equal(f.feedback.at(-1), "Understanding…");
  f.notice({ type: "speech-started" });
  f.notice({ type: "user-transcript", text: "What time is it?" });
  f.notice({ type: "speech-stopped" });
  assert.equal(f.counts().interruptions, 1);
  assert.equal(f.counts().waits, 1);
  assert.equal(f.feedback.at(-1), "Preparing a reply…");
});

test("stalled reply shows delay then releases the session; no automatic command replay", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.session.sendUserText("Hello");
  t.mock.timers.tick(8000);
  assert.match(f.feedback.at(-1)!, /longer than usual/);
  t.mock.timers.tick(22000);
  assert.deepEqual(f.errors, ["Voice reply timed out · say dex to retry"]);
  assert.deepEqual(f.disconnected, ["error"]);
  assert.equal(f.counts().ends, 1);
});

test("ignored noise preserves a pending reply and its stall recovery", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.session.sendUserText("Hello");
  f.notice({ type: "input-state", state: "hearing" });
  f.notice({ type: "input-state", state: "idle" });
  assert.equal(f.session.isWaiting, true);
  assert.equal(f.feedback.at(-1), "Preparing a reply…");
  t.mock.timers.tick(30000);
  assert.deepEqual(f.disconnected, ["error"]);
});

test("tool execution is not mistaken for a stalled voice reply; its result starts a new deadline", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.session.sendUserText("Research this");
  f.notice({ type: "tool-call", call: { toolCallId: "task", toolName: "run_task", input: {} } });
  f.notice({ type: "turn-done" });
  t.mock.timers.tick(90000);
  assert.deepEqual(f.disconnected, []);
  assert.equal(f.feedback.at(-1), "Working on your request");
  f.session.sendToolResult("task", "run_task", { result: "Done" });
  t.mock.timers.tick(30000);
  assert.deepEqual(f.disconnected, ["error"]);
});

test("discarded wake audio releases idle timeout; closing clears all response timers", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  Object.assign(f.session, { wakeReplayPending: true, responsePending: true });
  f.notice({ type: "input-state", state: "hearing" });
  f.notice({ type: "input-state", state: "retry" });
  assert.equal(f.session.isWaiting, false);
  assert.match(f.feedback.at(-1)!, /try again/);
  t.mock.timers.tick(60000);
  assert.deepEqual(f.disconnected, ["idle"]);
  assert.equal(f.counts().ends, 1);
});

test("session errors are visible and close the failed session", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.session.sendUserText("Hello");
  f.notice({ type: "error", message: "Provider rejected the turn" });
  assert.deepEqual(f.errors, ["Voice connection failed · say dex to retry"]);
  assert.deepEqual(f.disconnected, ["error"]);
  t.mock.timers.tick(90000);
  assert.equal(f.counts().ends, 1);
});


test("exhausted credits surface billing recovery and still release the failed session", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.session.sendUserText("Hello");
  f.notice({ type: "error", message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/." });
  assert.deepEqual(f.errors, ["Voice credits exhausted · add provider credits or change provider in Settings"]);
  assert.deepEqual(f.disconnected, ["error"]);
  assert.equal(f.session.isWaiting, false);
  t.mock.timers.tick(90000);
  assert.equal(f.counts().ends, 1);
});


test("recovery distinguishes account repair from transient retry without exposing arbitrary errors", () => {
  for (const message of ["insufficient_quota", "You exceeded your current quota", "credit balance is too low"]) {
    assert.match(voiceErrorFeedback(message, "buddy"), /credits exhausted/);
    assert.doesNotMatch(voiceErrorFeedback(message, "buddy"), /retry/);
  }
  assert.match(voiceErrorFeedback("Incorrect API key provided: private-value", "buddy"), /check your provider API key/);
  assert.match(voiceErrorFeedback("rate_limit_exceeded", "buddy"), /wait briefly, then say buddy/);
  assert.equal(voiceErrorFeedback("private request details", "buddy"), "Voice connection failed · say buddy to retry");
  assert.equal(isVoiceFailureFeedback(voiceErrorFeedback("insufficient_quota", "buddy")), true);
  assert.equal(isVoiceFailureFeedback("Speech detected"), false);
  assert.equal(isVoiceFailureFeedback("Connecting voice…"), false);
});

// Exercise the startup handoff with the actual renderer notice consumer.
test("credit error before renderer subscription survives immediate provider close", t => {
  const f = fixture(t);
  const buffer = new RealtimeNoticeBuffer(f.notice);
  buffer.push({ type: "open" });
  buffer.push({ type: "error", message: "You have no credits remaining." });
  buffer.push({ type: "closed", reason: "server" });
  assert.deepEqual(f.errors, []);
  buffer.subscribe();
  assert.match(f.errors[0], /credits exhausted/);
  assert.deepEqual(f.disconnected, ["error"]);
  buffer.subscribe();
  assert.equal(f.counts().ends, 1);
});

test("startup notices are ordered, bounded and discarded on teardown", () => {
  const delivered: RealtimeServerNotice[] = [];
  const buffer = new RealtimeNoticeBuffer(notice => delivered.push(notice));
  buffer.push({ type: "open" });
  buffer.subscribe();
  buffer.push({ type: "closed", reason: "server" });
  assert.deepEqual(delivered.map(n => n.type), ["open", "closed"]);
  buffer.dispose();
  buffer.push({ type: "open" });
  assert.equal(delivered.length, 2);
  const overflow = new RealtimeNoticeBuffer(notice => delivered.push(notice));
  for (let i = 0; i < 100; i++) overflow.push({ type: "open" });
  overflow.subscribe();
  assert.equal(delivered.length, 3);
  assert.equal(delivered[2].type, "error");
});
