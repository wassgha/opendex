import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { streamChat } from '../src/main/agent/chat';

for (const reason of ['error', 'stop'] as const) {
  test(`empty provider completion (${reason}) rejects rather than reporting success`, async () => {
    const model = new MockLanguageModelV3({ doStream: async () => ({
      stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'finish', finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } },
      ] }),
    }) });
    const deltas: string[] = [];
    await assert.rejects(streamChat({ model, system: 'Fixture', messages: [{ role: 'user', content: 'Fixture task' }], onDelta: t => deltas.push(t) }), /before taking any action.*incomplete/);
    assert.deepEqual(deltas, []);
  });
}
test('provider failure after text does not return partial narration as completion', async () => {
  const model = new MockLanguageModelV3({ doStream: async () => ({
    stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Starting.' }, { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
    ] }),
  }) });
  await assert.rejects(streamChat({ model, system: 'Fixture', messages: [{ role: 'user', content: 'Fixture task' }], onDelta: () => {} }), /failed response/);
});

test('a length stop identifies the provider limit without assuming its cause', async () => {
  const model = new MockLanguageModelV3({ provider: 'openai.responses', modelId: 'gpt-5', doStream: async options => {
    assert.equal(options.maxOutputTokens, undefined);
    return { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'finish', finishReason: { unified: 'length', raw: 'max_output_tokens' }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } },
    ] }) };
  } });
  await assert.rejects(streamChat({ model, system: 'Fixture', messages: [{ role: 'user', content: 'Fixture task' }], onDelta: () => {} }), /output token limit/);
});
