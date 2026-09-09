import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { gateway } from '@ai-sdk/gateway';
import { startRealtimeSession, endRealtimeSession, sendRealtimeClientMessage } from '../src/main/agent/realtime/session-host';

test('completed generation still playing ignores yeah without restarting audio; question answers interrupt', async () => {
  const previousSocket = globalThis.WebSocket;
  const previousKey = process.env.AI_GATEWAY_API_KEY;
  let socket: FakeSocket;
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent: any[] = [];
    constructor() { super(); socket = this; setImmediate(() => this.dispatchEvent(new Event('open'))); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    async receive(value: object) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  process.env.AI_GATEWAY_API_KEY = 'test-only';
  const token = mock.method(gateway.experimental_realtime, 'getToken', async () => ({ token: 'test-only', url: 'wss://example.invalid' }));
  const notices: any[] = [];
  let finishLookup!: (value: unknown) => void;
  const lookup = new Promise(resolve => { finishLookup = resolve; });
  const sessionId = 'playback-acknowledgment-test';
  let item = 0;
  const speak = async (text: string) => {
    const itemId = `input-${++item}`;
    await socket.receive({ type: 'speech-started', itemId });
    await socket.receive({ type: 'speech-stopped', itemId });
    await socket.receive({ type: 'input-transcription-completed', itemId, transcript: text });
  };
  try {
    await startRealtimeSession({ sessionId, model: 'openai/gpt-realtime-2', voice: '', instructions: 'Test', toolDefs: [], tools: { listLocalAgents: { execute: () => lookup } } as never, transcribesInput: true, notify: n => notices.push(n) });
    await speak('List my tasks');
    await socket!.receive({ type: 'response-created', responseId: 'summary' });
    await socket!.receive({ type: 'audio-transcript-delta', responseId: 'summary', delta: 'One task is active. The other task is idle.' });
    sendRealtimeClientMessage(sessionId, { type: 'diagnostic', event: 'playback-start' });
    await socket!.receive({ type: 'response-done', responseId: 'summary', status: 'completed' });
    const before = socket!.sent.length, noticeCount = notices.length;
    await speak('Yeah');
    assert.equal(socket!.sent.length, before, 'must neither cancel nor request another response');
    assert.deepEqual(notices.slice(noticeCount).map(n => n.type), ['input-state', 'input-state', 'input-state'], 'feedback must not flush playback or replace its transcript');

    sendRealtimeClientMessage(sessionId, { type: 'diagnostic', event: 'playback-stop' });
    await speak('Yeah');
    assert.equal(socket!.sent.filter(e => e.type === 'response-create').length, 2, 'idle speech remains a turn');
    await socket!.receive({ type: 'response-created', responseId: 'question' });
    await socket!.receive({ type: 'audio-transcript-delta', responseId: 'question', delta: 'Should I open that task?' });
    sendRealtimeClientMessage(sessionId, { type: 'diagnostic', event: 'playback-start' });
    await speak('Yeah');
    assert.equal(socket!.sent.filter(e => e.type === 'response-cancel').length, 1, 'an actual answer can interrupt the question');
    assert.equal(notices.filter(e => e.type === 'user-transcript').length, 3);
    await socket!.receive({ type: 'response-done', responseId: 'question', status: 'cancelled' });
    await socket!.receive({ type: 'response-created', responseId: 'lookup-intro' });
    await socket!.receive({ type: 'audio-transcript-delta', responseId: 'lookup-intro', delta: 'Let me check the current tasks.' });
    await socket!.receive({ type: 'function-call-arguments-done', responseId: 'lookup-intro', callId: 'lookup', name: 'listLocalAgents', arguments: '{}' });
    await socket!.receive({ type: 'response-done', responseId: 'lookup-intro', status: 'completed' });
    sendRealtimeClientMessage(sessionId, { type: 'diagnostic', event: 'playback-stop' });
    const waitingRequests = socket!.sent.filter(e => e.type === 'response-create').length;
    const waitingNotices = notices.length;
    await speak('Okay');
    assert.deepEqual(notices.slice(waitingNotices).map(n => n.type), ['input-state', 'input-state', 'input-state'], 'acknowledgment feedback must not supersede the command');
    assert.equal(socket!.sent.filter(e => e.type === 'response-create').length, waitingRequests);
    await socket!.receive({ type: 'response-created', responseId: 'lookup-progress' });
    await socket!.receive({ type: 'response-done', responseId: 'lookup-progress', status: 'completed' });
    finishLookup({ tasks: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(socket!.sent.filter(e => e.type === 'response-create').length, waitingRequests + 1, 'successful lookup must still request its answer');

  } finally {
    endRealtimeSession(sessionId); token.mock.restore(); globalThis.WebSocket = previousSocket;
    if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});
