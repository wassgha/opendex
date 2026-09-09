import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gateway } from '@ai-sdk/gateway';
import { startRealtimeSession, endRealtimeSession, sendRealtimeClientMessage, delegatedDesktopJob } from '../src/main/agent/realtime/session-host';
import { DesktopDelegations } from '../src/main/agent/realtime/desktop-delegations';
import { realtimeArchiveFallback } from '../src/skills/local-agent-actions/archive-fallback';
const target = 'b96dc42d-cd8c-47ea-836a-9302a378a397';
const rejection = { state: 'rejected', failureKind: 'active-writer', taskId: target,
  fallback: { state: 'ready_not_performed', taskId: target, task: 'Archive the exact selected task through the permitted desktop workflow.' } };

test('only a matching confirmed archive rejection may dispatch computer work', () => {
  assert.ok(realtimeArchiveFallback('archiveLocalAgentTask', { taskId: target }, rejection));
  for (const output of [{ ...rejection, state: 'unconfirmed' }, { ...rejection, fallback: { state: 'unavailable' } }, { ...rejection, taskId: 'wrong' }])
    assert.equal(realtimeArchiveFallback('archiveLocalAgentTask', { taskId: target }, output), undefined);
  assert.equal(realtimeArchiveFallback('webSearch', { taskId: target }, rejection), undefined);
});

test('desktop queue serializes workers, ignores duplicate results, and drops cancelled work', () => {
  const dispatched: string[] = [];
  const queue = new DesktopDelegations(job => dispatched.push(job.callId));
  const a = { callId: 'a', name: 'run_task', task: 'a' }, b = { callId: 'b', name: 'run_task', task: 'b' };
  queue.enqueue(a); queue.enqueue(a); queue.enqueue(b);
  assert.deepEqual(dispatched, ['a']);
  assert.equal(queue.beginResult('b'), undefined);
  assert.equal(queue.beginResult('a'), a);
  assert.equal(queue.beginResult('a'), undefined);
  queue.clear(); queue.finish(a);
  assert.deepEqual(dispatched, ['a']);
  assert.equal(queue.beginResult('a'), undefined);
});

test('host dispatches archive fallback without another model decision and verifies before answering', async () => {
  const previousSocket = globalThis.WebSocket, previousKey = process.env.AI_GATEWAY_API_KEY;
  let socket!: FakeSocket;
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1; sent: any[] = [];
    constructor() { super(); socket = this; setImmediate(() => this.dispatchEvent(new Event('open'))); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    async receive(value: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); await tick(); }
  }
  const tick = () => new Promise(resolve => setImmediate(resolve));
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  process.env.AI_GATEWAY_API_KEY = 'test-only';
  const token = mock.method(gateway.experimental_realtime, 'getToken', async () => ({ token: 'test-only', url: 'wss://example.invalid' }));
  const notices: any[] = []; let verified = 0;
  const sessionId = 'archive-delegation-test';
  const outputs = () => socket.sent.filter(e => e.type === 'conversation-item-create' && e.item.type === 'function-call-output');
  try {
    await startRealtimeSession({ sessionId, model: 'openai/gpt-realtime-2', voice: '', instructions: 'Test',
      toolDefs: [{ name: 'run_task', description: '', parameters: {} }],
      tools: { archiveLocalAgentTask: { execute: async () => rejection }, verifyLocalAgentTaskArchive: { execute: async () => { verified++; return { state: 'archived', taskId: target }; } } } as never,
      transcribesInput: true, notify: n => notices.push(n) });
    sendRealtimeClientMessage(sessionId, { type: 'user-text', text: 'Archive the selected tasks' }); await tick();
    await socket.receive({ type: 'response-created', responseId: 'r' });
    for (const callId of ['a', 'b']) await socket.receive({ type: 'function-call-arguments-done', responseId: 'r', callId, name: 'archiveLocalAgentTask', arguments: JSON.stringify({ taskId: target }) });
    await socket.receive({ type: 'response-done', responseId: 'r', status: 'completed' });
    assert.deepEqual(notices.filter(n => n.type === 'run-task').map(n => n.toolCallId), ['a']);
    assert.equal(outputs().length, 0, 'rejection must not return to the model before fallback');
    sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'a', name: 'run_task', output: { result: 'Clicked archive' } }); await tick();
    assert.equal(verified, 1);
    assert.equal(outputs()[0].item.name, 'archiveLocalAgentTask');
    assert.equal(JSON.parse(outputs()[0].item.output).state, 'archived');
    assert.deepEqual(notices.filter(n => n.type === 'run-task').map(n => n.toolCallId), ['a', 'b']);
    sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'a', name: 'run_task', output: { result: 'duplicate' } }); await tick();
    assert.equal(verified, 1);
    const worker = delegatedDesktopJob(sessionId, 'b')!;
    sendRealtimeClientMessage(sessionId, { type: 'cancel-response' });
    assert.equal(worker.controller?.signal.aborted, true, 'main aborts the real worker signal');
    sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'b', name: 'run_task', output: { result: 'late' } }); await tick();
    assert.equal(outputs().length, 2, 'only the verified result and explicit cancellation receipt are sent');
    assert.equal(JSON.parse(outputs()[1].item.output).state, 'cancelled');
  } finally {
    endRealtimeSession(sessionId); token.mock.restore(); globalThis.WebSocket = previousSocket;
    if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});

for (const interrupt of ['speech', 'status-then-stop', 'status-then-complete', 'playback-noise-then-stop', 'typed', 'cancel', 'close', 'verification'] as const) test(`${interrupt}: desktop work follows the requested lifecycle`, async () => {
  const previousSocket = globalThis.WebSocket, previousKey = process.env.AI_GATEWAY_API_KEY;
  let socket!: FakeSocket;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  class FakeSocket extends EventTarget {
    static OPEN = 1; readyState = 1; sent: any[] = [];
    constructor() { super(); socket = this; setImmediate(() => this.dispatchEvent(new Event('open'))); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    async receive(value: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); await tick(); }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  process.env.AI_GATEWAY_API_KEY = 'test-only';
  const token = mock.method(gateway.experimental_realtime, 'getToken', async () => ({ token: 'test-only', url: 'wss://example.invalid' }));
  const notices: any[] = [], sessionId = `abort-worker-${interrupt}`;
  try {
    await startRealtimeSession({ sessionId, model: 'openai/gpt-realtime-2', voice: '', instructions: 'Test', toolDefs: [{ name: 'run_task', description: '', parameters: {} }], tools: { archiveLocalAgentTask: { execute: async () => rejection }, verifyLocalAgentTaskArchive: { execute: async () => ({ state: 'unarchived', taskId: target }) } } as never, transcribesInput: true, notify: n => notices.push(n) });
    sendRealtimeClientMessage(sessionId, { type: 'user-text', text: 'Do the desktop work' }); await tick();
    await socket.receive({ type: 'response-created', responseId: 'r' });
    for (const callId of ['active', 'queued']) await socket.receive({ type: 'function-call-arguments-done', responseId: 'r', callId, name: interrupt === 'verification' ? 'archiveLocalAgentTask' : 'run_task', arguments: interrupt === 'verification' ? JSON.stringify({ taskId: target }) : '{"task":"test"}' });
    await socket.receive({ type: 'response-done', responseId: 'r', status: 'completed' });
    const worker = delegatedDesktopJob(sessionId, 'active')!;
    assert.ok(worker);
    assert.equal(delegatedDesktopJob(sessionId, 'queued'), undefined, 'queued handoffs cannot start early');
    if (interrupt === 'verification') {
      sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'active', name: 'run_task', output: { result: 'Claimed done' } });
      await tick();
      assert.equal(delegatedDesktopJob(sessionId, 'active'), undefined);
      assert.deepEqual(notices.filter(n => n.type === 'run-task').map(n => n.toolCallId), ['active']);
      assert.equal(notices.find(n => n.type === 'tool-result' && n.result.toolCallId === 'active').result.output.state, 'unarchived');
      assert.equal(notices.find(n => n.type === 'tool-result' && n.result.toolCallId === 'queued').result.output.state, 'cancelled');
      return;
    }
    if (interrupt === 'status-then-stop' || interrupt === 'status-then-complete') {
      const before = notices.length;
      for (const [index, transcript] of ['What are you doing?', "Dex, what's going on?", 'Dex was wrong.', "No, I'm asking what's going on."].entries()) {
        await socket.receive({ type: 'speech-started', itemId: `status-${index}` });
        await socket.receive({ type: 'speech-stopped', itemId: `status-${index}` });
        await socket.receive({ type: 'input-transcription-completed', itemId: `status-${index}`, transcript });
      }
      assert.equal(worker.controller!.signal.aborted, false);
      assert.equal(delegatedDesktopJob(sessionId, 'active'), worker);
      assert.equal(notices.slice(before).some(n => n.type === 'speech-started'), false);
      assert.ok(socket.sent.some(e => e.type === 'response-create' && e.options?.instructions?.includes('has not cancelled')));
      if (interrupt === 'status-then-complete') {
        await socket.receive({ type: 'response-created', responseId: 'status-response' });
        await socket.receive({ type: 'response-done', responseId: 'status-response', status: 'completed' });
        sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'active', name: 'run_task', output: { result: 'Verified fixture result' } });
        await tick();
        assert.equal(worker.controller!.signal.aborted, false);
        assert.ok(notices.some(n => n.type === 'tool-result' && n.result.output.result === 'Verified fixture result'));
        assert.ok(delegatedDesktopJob(sessionId, 'queued'));
        return;
      }
      sendRealtimeClientMessage(sessionId, { type: 'cancel-response' });
    } else if (interrupt === 'playback-noise-then-stop') {
      sendRealtimeClientMessage(sessionId, { type: 'diagnostic', event: 'playback-start' });
      for (let i = 0; i < 9; i++) sendRealtimeClientMessage(sessionId, { type: 'audio', chunk: new ArrayBuffer(1536), speechProbability: 0.99 });
      await socket.receive({ type: 'speech-started', itemId: 'noise', raw: { audio_start_ms: 0 } });
      await socket.receive({ type: 'speech-stopped', itemId: 'noise', raw: { audio_end_ms: 288 } });
      await socket.receive({ type: 'input-transcription-completed', itemId: 'noise', transcript: 'left.' });
      assert.equal(worker.controller!.signal.aborted, false, 'playback noise must not cancel the active worker');
      assert.equal(notices.some(n => n.type === 'user-transcript' && n.text === 'left.'), false);
      await socket.receive({ type: 'speech-started', itemId: 'stop', raw: { audio_start_ms: 0 } });
      await socket.receive({ type: 'speech-stopped', itemId: 'stop', raw: { audio_end_ms: 288 } });
      await socket.receive({ type: 'input-transcription-completed', itemId: 'stop', transcript: 'Stop.' });
    } else if (interrupt === 'speech') {
      await socket.receive({ type: 'speech-started', itemId: 'stop' });
      assert.equal(worker.controller!.signal.aborted, false, 'unconfirmed detection is not authorization to interrupt');
      await socket.receive({ type: 'speech-stopped', itemId: 'stop' });
      await socket.receive({ type: 'input-transcription-completed', itemId: 'stop', transcript: 'Dex stop.' });
    } else if (interrupt === 'typed') sendRealtimeClientMessage(sessionId, { type: 'user-text', text: 'Stop' });
    else if (interrupt === 'cancel') sendRealtimeClientMessage(sessionId, { type: 'cancel-response' });
    else endRealtimeSession(sessionId);
    await tick();
    assert.equal(worker.controller!.signal.aborted, true);
    let clicks = 0;
    await assert.rejects((async () => { worker.controller!.signal.throwIfAborted(); clicks++; })());
    assert.equal(clicks, 0);
    sendRealtimeClientMessage(sessionId, { type: 'tool-result', toolCallId: 'active', name: 'run_task', output: { result: 'late' } }); await tick();
    assert.equal(delegatedDesktopJob(sessionId, 'active'), undefined);
    assert.deepEqual(notices.filter(n => n.type === 'run-task').map(n => n.toolCallId), ['active']);
    assert.equal(notices.filter(n => n.type === 'tool-result' && n.result.output.state === 'cancelled').length, 2);
    const receipt = notices.find(n => n.type === 'tool-result' && n.result.output.state === 'cancelled').result.output;
    assert.match(receipt.notice, /session controller/);
    if (interrupt === 'speech') assert.equal(receipt.reason, 'accepted spoken input interrupted the active task');
    if (interrupt === 'cancel' || interrupt === 'status-then-stop') assert.equal(receipt.reason, 'explicit cancellation requested');
  } finally {
    endRealtimeSession(sessionId); token.mock.restore(); globalThis.WebSocket = previousSocket;
    if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previousKey;
  }
});
