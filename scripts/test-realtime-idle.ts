import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RealtimeVoiceSession, type RealtimeSessionCallbacks } from "../src/renderer/src/lib/dex/realtime/realtime-session";
import { announceSleep } from "../src/renderer/src/lib/dex/sleep-announcement";
import type { RealtimeServerNotice } from "../src/main/ipc/channels";

function idleSession(idleDisconnectSec = 30) {
  const disconnected: string[] = [];
  let ended = 0;
  Object.assign(globalThis, { window: { opendex: { realtimeSend: () => {}, realtimeEnd: () => ended++ } } });
  const noop = () => {};
  const callbacks: RealtimeSessionCallbacks = {
    onUserSpeechStart: noop, onUserTranscript: noop, onAssistantDelta: noop,
    onTurnDone: noop, onSpeakingChange: noop, onToolCall: noop, onToolResult: noop,
    onRunTask: noop, onAudioBlocked: noop, onDisconnect: (reason) => disconnected.push(reason),
  };
  const session = new RealtimeVoiceSession({ micStream: {} as MediaStream, idleDisconnectSec, callbacks });
  const controls = session as unknown as { resetIdle(): void; handleNotice(notice: RealtimeServerNotice): void };
  controls.resetIdle();
  return { session, controls, disconnected, ended: () => ended };
}

test("30 seconds of quiet closes the mic session once with the idle reason", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = idleSession();
  t.mock.timers.tick(29999);
  assert.deepEqual(s.disconnected, []);
  t.mock.timers.tick(1);
  assert.deepEqual(s.disconnected, ["idle"]);
  assert.equal(s.ended(), 1);
  t.mock.timers.tick(30000);
  assert.equal(s.ended(), 1);
});

test("thinking and outstanding tools do not count as idle silence", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Exercise idle expiry before the separate 30-second stalled-reply watchdog.
  const s = idleSession(5);
  s.controls.handleNotice({ type: "speech-stopped" });
  t.mock.timers.tick(5000);
  assert.deepEqual(s.disconnected, []);
  s.controls.handleNotice({ type: "tool-call", call: { toolCallId: "task", toolName: "run_task", input: {} } });
  s.controls.handleNotice({ type: "turn-done" });
  t.mock.timers.tick(30000);
  assert.deepEqual(s.disconnected, []);
  s.controls.handleNotice({ type: "tool-result", result: { toolCallId: "task", toolName: "run_task", output: "done" } });
  s.controls.handleNotice({ type: "turn-done" });
  t.mock.timers.tick(30000);
  assert.deepEqual(s.disconnected, ["idle"]);
});

function speechStub() {
  let utterance: { text: string; onend?: () => void } | undefined;
  Object.assign(globalThis, {
    SpeechSynthesisUtterance: class { constructor(public text: string) {} },
    window: { speechSynthesis: { getVoices: () => [], cancel: () => {}, speak: (u: typeof utterance) => { utterance = u; } } },
  });
  return () => utterance!;
}

test("sleep announcement finishes before wake listening resumes; cancel does not resume", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const getUtterance = speechStub();
  let resumes = 0;
  const voice = { voiceURI: null, rate: 1, pitch: 1 };
  announceSleep(voice, () => resumes++);
  assert.equal(getUtterance().text, "Going to sleep.");
  assert.equal(resumes, 0);
  getUtterance().onend?.();
  assert.equal(resumes, 1);
  t.mock.timers.tick(5000);
  assert.equal(resumes, 1);
  const cancel = announceSleep(voice, () => resumes++);
  cancel();
  getUtterance().onend?.();
  t.mock.timers.tick(5000);
  assert.equal(resumes, 1);
});

test("unresponsive speech falls back to wake listening after five seconds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  speechStub();
  let resumes = 0;
  announceSleep({ voiceURI: null, rate: 1, pitch: 1 }, () => resumes++);
  t.mock.timers.tick(5000);
  assert.equal(resumes, 1);
});

test("a transcribed sleep command closes the session immediately without waiting for the model", () => {
  const s = idleSession();
  s.controls.handleNotice({type:"user-transcript",text:"Dex, go to sleep."});
  assert.deepEqual(s.disconnected,["sleep"]);
  assert.equal(s.ended(),1);
  s.controls.handleNotice({type:"closed",reason:"ended"});
  assert.equal(s.ended(),1);
});

test("model sleep tool uses the same real disconnect path", () => {
  const s = idleSession();
  s.controls.handleNotice({type:"sleep"});
  assert.deepEqual(s.disconnected,["sleep"]);
  assert.equal(s.ended(),1);
});
