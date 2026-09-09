import { strict as assert } from "node:assert";
import { test, mock } from "node:test";
import { gateway } from "@ai-sdk/gateway";
import { startRealtimeSession, endRealtimeSession, sendRealtimeClientMessage } from "../src/main/agent/realtime/session-host";

test("the session host withholds model audio and tools for an empty spoken turn", async () => {
  const previousSocket = globalThis.WebSocket;
  const previousKey = process.env.AI_GATEWAY_API_KEY;
  let socket: FakeSocket;
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent: unknown[] = [];
    constructor() { super(); socket = this; setImmediate(() => this.dispatchEvent(new Event("open"))); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    async receive(value: object) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  process.env.AI_GATEWAY_API_KEY = "test-only";
  const token = mock.method(gateway.experimental_realtime, "getToken", async () => ({ token: "test-only", url: "wss://example.invalid" }));
  const notices: Array<{ type: string }> = [];
  let calls = 0;
  try {
    await startRealtimeSession({ sessionId: "empty-speech-test", model: "openai/gpt-realtime-2", voice: "", instructions: "Test", toolDefs: [],
      tools: { ping: { execute: async () => { calls++; return {}; } } } as never,
      transcribesInput: true, notify: notice => notices.push(notice) });
    const config = socket!.sent.find((e: any) => e.type === "session-update") as any;
    assert.deepEqual(config.config.providerOptions.audio.input.turn_detection,
      { type: "semantic_vad", eagerness: "high", create_response: false, interrupt_response: false });
    await socket!.receive({ type: "speech-started", itemId: "noise" });
    assert.deepEqual(notices.at(-1), { type: "input-state", state: "hearing" });
    assert.equal(notices.some(n => n.type === "speech-started"), false, "detection must not interrupt playback");
    await socket!.receive({ type: "speech-stopped", itemId: "noise" });
    assert.deepEqual(notices.at(-1), { type: "input-state", state: "processing" });
    await socket!.receive({ type: "response-created", responseId: "invented" });
    await socket!.receive({ type: "audio-delta", responseId: "invented", itemId: "output", delta: "AAA=" });
    await socket!.receive({ type: "function-call-arguments-done", responseId: "invented", itemId: "tool", callId: "call", name: "ping", arguments: "{}" });
    assert.equal(calls, 0);
    assert.equal(notices.some(n => n.type === "audio" || n.type === "tool-call"), false);
    await socket!.receive({ type: "input-transcription-completed", itemId: "noise", transcript: "" });
    assert.deepEqual(notices.at(-1), { type: "input-state", state: "retry" });
    assert.equal(calls, 0);
    assert.equal(notices.some(n => n.type === "closed" || n.type === "speech-started"), false);
    assert.equal(socket!.readyState, 1);

    // A nonempty transcript must not interrupt when its exact playback audio
    // interval was consistently classified as non-speech.
    sendRealtimeClientMessage("empty-speech-test", { type: "diagnostic", event: "playback-start" });
    for (let i = 0; i < 20; i++) sendRealtimeClientMessage("empty-speech-test", {
      type: "audio", chunk: new ArrayBuffer(1536), speechProbability: 0.158,
    });
    const beforeNoise = notices.length;
    const requestsBefore = socket!.sent.filter((e: any) => e.type === "response-create").length;
    await socket!.receive({ type: "speech-started", itemId: "playback-noise", raw: { audio_start_ms: 0 } });
    await socket!.receive({ type: "speech-stopped", itemId: "playback-noise", raw: { audio_end_ms: 640 } });
    await socket!.receive({ type: "input-transcription-completed", itemId: "playback-noise", transcript: "Invented greeting" });
    assert.equal(notices.slice(beforeNoise).some(n => n.type === "user-transcript" || n.type === "speech-started"), false);
    assert.deepEqual(notices.at(-1), { type: "input-state", state: "idle" });
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, requestsBefore);
    assert.equal(calls, 0);

    // Incident-shaped spikes: final words must not reach UI, cancel playback,
    // create a response, or grant tools merely because transcription finalized.
    for (const [index, scores] of [[0, [0.01, 0.86, 0.8, 0.7, 0.01]], [1, [0.01, 0.251, 0.01, 0.01, 0.01]]] as const) {
      for (const speechProbability of scores) sendRealtimeClientMessage("empty-speech-test", {
        type: "audio", chunk: new ArrayBuffer(1536), speechProbability,
      });
      const itemId = `spike-${index}`;
      await socket!.receive({ type: "speech-started", itemId, raw: { audio_start_ms: 640 + index * 160 } });
      await socket!.receive({ type: "speech-stopped", itemId, raw: { audio_end_ms: 800 + index * 160 } });
      await socket!.receive({ type: "input-transcription-completed", itemId, transcript: "An invented request" });
      assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, requestsBefore);
      assert.equal(notices.slice(beforeNoise).some(n => n.type === "user-transcript" || n.type === "speech-started"), false);
    }

    // Moderate-confidence, quiet real speech in the next interval still wins.
    for (let i = 0; i < 20; i++) sendRealtimeClientMessage("empty-speech-test", {
      type: "audio", chunk: new ArrayBuffer(1536), speechProbability: 0.333,
    });
    await socket!.receive({ type: "speech-started", itemId: "real-interruption", raw: { audio_start_ms: 960 } });
    await socket!.receive({ type: "speech-stopped", itemId: "real-interruption", raw: { audio_end_ms: 1600 } });
    await socket!.receive({ type: "input-transcription-completed", itemId: "real-interruption", transcript: "Wait, change that" });
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, requestsBefore + 1);
    const sent = socket!.sent as any[];
    const replacement = sent.findIndex(e => e.type === "conversation-item-create" && e.item?.text === "Wait, change that");
    assert.ok(replacement >= 0);
    assert.equal(sent[replacement + 1].type, "response-create", "accepted text must precede generation");
    assert.match(sent[replacement + 1].options.instructions, /Latest accepted user text.*Wait, change that/);

    notices.length = 0;
    await startRealtimeSession({ sessionId: "overlap-replay-test", model: "openai/gpt-realtime-2", voice: "", instructions: "Test", toolDefs: [], tools: {}, transcribesInput: true, notify: notice => notices.push(notice) });
    sendRealtimeClientMessage("overlap-replay-test", { type: "diagnostic", event: "playback-start" });
    sendRealtimeClientMessage("overlap-replay-test", { type: "audio", chunk: new ArrayBuffer(48000), speechProbability: 0.01 });
    sendRealtimeClientMessage("overlap-replay-test", { type: "diagnostic", event: "playback-stop" });
    for (let i = 0; i < 100; i++) sendRealtimeClientMessage("overlap-replay-test", {
      type: "audio", chunk: new ArrayBuffer(1536), speechProbability: i > 25 ? 0.7 : 0.01,
    });
    await socket!.receive({ type: "speech-started", itemId: "first-clause", raw: { audio_start_ms: 1600 } });
    await socket!.receive({ type: "speech-stopped", itemId: "first-clause", raw: { audio_end_ms: 3000 } });
    await socket!.receive({ type: "speech-started", itemId: "second-clause", raw: { audio_start_ms: 3000 } });
    await socket!.receive({ type: "speech-stopped", itemId: "second-clause", raw: { audio_end_ms: 4200 } });
    await socket!.receive({ type: "input-transcription-completed", itemId: "second-clause", transcript: "with repeatable scenarios." });
    assert.equal(socket!.sent.some((e: any) => e.type === "response-create"), false);
    await socket!.receive({ type: "input-transcription-completed", itemId: "first-clause", transcript: "Build a browser benchmark" });
    assert.deepEqual(notices.filter(n => n.type === "user-transcript"), [
      { type: "user-transcript", text: "Build a browser benchmark with repeatable scenarios." },
    ]);
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, 1);
    assert.match((socket!.sent.find((e: any) => e.type === "response-create") as any).options.instructions,
      /Build a browser benchmark with repeatable scenarios/);

    notices.length = 0;
    await startRealtimeSession({ sessionId: "valid-speech-test", model: "openai/gpt-realtime-2", voice: "", instructions: "Test", toolDefs: [], tools: {}, transcribesInput: true, notify: notice => notices.push(notice) });
    await socket!.receive({ type: "speech-started", itemId: "speech" });
    await socket!.receive({ type: "speech-stopped", itemId: "speech" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "speech", transcript: "hello" });
    await socket!.receive({ type: "response-created", responseId: "answer" });
    await socket!.receive({ type: "audio-delta", responseId: "answer", itemId: "output", delta: "AAA=" });

    assert.equal(notices.filter(n => n.type === "audio").length, 1);
    const cancels = socket!.sent.filter((e: any) => e.type === "response-cancel").length;
    const starts = notices.filter(n => n.type === "speech-started").length;
    await socket!.receive({ type: "speech-started", itemId: "incidental-hmm" });
    await socket!.receive({ type: "speech-stopped", itemId: "incidental-hmm" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "incidental-hmm", transcript: "Hmm" });
    assert.equal(notices.filter(n => n.type === "speech-started").length, starts);
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-cancel").length, cancels);
    await socket!.receive({ type: "speech-started", itemId: "false-interruption" });
    await socket!.receive({ type: "speech-stopped", itemId: "false-interruption" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "false-interruption", transcript: "" });
    await socket!.receive({ type: "audio-delta", responseId: "answer", itemId: "output", delta: "AAA=" });
    assert.equal(notices.filter(n => n.type === "audio").length, 2);
    assert.equal(notices.filter(n => n.type === "speech-started").length, starts);
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-cancel").length, cancels);
    assert.equal(socket!.readyState, 1);
    await socket!.receive({ type: "function-call-arguments-done", responseId: "answer", itemId: "task", callId: "research-task", name: "run_task", arguments: '{"task":"Research the question"}' });
    await socket!.receive({ type: "response-done", responseId: "answer", status: "completed" });
    await socket!.receive({ type: "speech-started", itemId: "worker-noise" });
    await socket!.receive({ type: "speech-stopped", itemId: "worker-noise" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "worker-noise", transcript: "" });
    sendRealtimeClientMessage("valid-speech-test", { type: "research-progress", toolCallId: "research-task", text: "Two sources use different definitions." });
    await new Promise(resolve => setImmediate(resolve));
    const requests = socket!.sent.filter((e: any) => e.type === "response-create") as Array<{ options?: { instructions?: string } }>;
    assert.match(requests.at(-1)?.options?.instructions ?? "", /Two sources use different definitions/);
    await socket!.receive({ type: "response-created", responseId: "progress" });
    const toolNotices = notices.filter(n => n.type === "tool-call").length;
    await socket!.receive({ type: "function-call-arguments-done", responseId: "progress", itemId: "unexpected", callId: "unexpected", name: "run_task", arguments: '{"task":"Start a duplicate task"}' });
    assert.equal(notices.filter(n => n.type === "tool-call").length, toolNotices);
    const before = socket!.sent.filter((e: any) => e.type === "response-create").length;
    await socket!.receive({ type: "speech-started", itemId: "real-interruption" });
    await socket!.receive({ type: "speech-stopped", itemId: "real-interruption" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "real-interruption", transcript: "Actually compare the running costs first" });
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, before);
    const audioBefore = notices.filter(n => n.type === "audio").length;
    await socket!.receive({ type: "audio-delta", responseId: "progress", itemId: "output", delta: "AAA=" });
    assert.equal(notices.filter(n => n.type === "audio").length, audioBefore);
    await socket!.receive({ type: "response-done", responseId: "progress", status: "cancelled" });
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, before + 1);
    const beforeRestart = socket!.sent.filter((e: any) => e.type === "response-create").length;
    await socket!.receive({ type: "speech-started", itemId: "restart-session" });
    await socket!.receive({ type: "speech-stopped", itemId: "restart-session" });
    await socket!.receive({ type: "input-transcription-completed", itemId: "restart-session", transcript: "Okay, new session." });
    assert.equal(notices.filter(n => n.type === "new-session").length, 1);
    assert.equal(socket!.sent.filter((e: any) => e.type === "response-create").length, beforeRestart);
    assert.equal(socket!.readyState, 3, "old connection must close without model generation");
    await startRealtimeSession({ sessionId: "audio-only-test", model: "xai/grok-voice-think-fast-1.0", voice: "", instructions: "Audio-only instructions", toolDefs: [], tools: {}, transcribesInput: false, notify: () => {} });
    const audioOnlyConfig = socket!.sent.find((e: any) => e.type === "session-update") as any;
    assert.equal(audioOnlyConfig.config.instructions, "Audio-only instructions", "models without transcription must still understand audio");
  } finally {
    endRealtimeSession("audio-only-test"); endRealtimeSession("overlap-replay-test");
    endRealtimeSession("empty-speech-test"); endRealtimeSession("valid-speech-test");
    token.mock.restore();
    globalThis.WebSocket = previousSocket;
    if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});
