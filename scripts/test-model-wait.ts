import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ModelWait } from '../src/main/agent/model-wait';
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
test('a silent model is aborted and marked as a timeout', async () => {
  const wait = new ModelWait(10); wait.waiting(); await delay();
  assert.equal(wait.timedOut, true); assert.equal(wait.controller.signal.aborted, true);
});
test('tool execution and permission waits are excluded; next model step is bounded', async () => {
  const wait = new ModelWait(10); wait.waiting(); wait.pause(); await delay();
  assert.equal(wait.controller.signal.aborted, false);
  wait.waiting(); await delay(); assert.equal(wait.timedOut, true);
});
test('cleanup prevents a delayed abort', async () => {
  const wait = new ModelWait(10); wait.waiting(); wait.pause(); await delay();
  assert.equal(wait.timedOut, false);
});

test('the real chat loop returns an explicit incomplete result on a stalled stream', async () => {
  const { MockLanguageModelV3 } = await import('ai/test');
  const { streamChat } = await import('../src/main/agent/chat');
  const model = new MockLanguageModelV3({ doStream: async ({ abortSignal }) => ({
    stream: new ReadableStream({ start(controller) {
      const abort = () => controller.error(abortSignal!.reason);
      if (abortSignal?.aborted) abort();
      else abortSignal?.addEventListener('abort', abort, { once: true });
    } }),
  }) });
  const text: string[] = [];
  const messages = await streamChat({ model, system: 'Test', messages: [{ role: 'user', content: 'Test timeout' }], modelWaitMs: 15, onDelta: t => text.push(t) });
  assert.match(text.join(''), /task is incomplete/i);
  assert.equal(messages.at(-1)?.role, 'assistant');
});
