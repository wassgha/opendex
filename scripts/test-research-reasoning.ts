import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import { researchReasoning, researchActionTools } from '../src/main/agent/research-reasoning';
const model = new MockLanguageModelV3({ provider: 'openai.responses', modelId: 'gpt-5' });
const messages = [{ role: 'user' as const, content: 'Research heat pumps in Chicago' }];
const steps = (stage: string) => [{toolResults:[{toolName:'updateResearch',output:{stage}}]}];
test('GPT-5 research begins promptly but uses deeper comparison and synthesis', () => {
  assert.equal(researchReasoning(model,messages,[])?.openai.reasoningEffort,'minimal');
  for (const stage of ['planning','searching','reading']) assert.equal(researchReasoning(model,messages,steps(stage))?.openai.reasoningEffort,'minimal');
  for (const stage of ['comparing','synthesizing','complete','blocked']) assert.equal(researchReasoning(model,messages,steps(stage))?.openai.reasoningEffort,'medium');
});
test('ordinary requests, other models, and other providers keep their settings', () => {
  assert.equal(researchReasoning(model,[{role:'user',content:'Explain this code'}],[]),undefined);
  for (const other of ['gpt-5',new MockLanguageModelV3({provider:'anthropic.messages',modelId:'gpt-5'}),new MockLanguageModelV3({provider:'openai.responses',modelId:'gpt-5.1'})]) assert.equal(researchReasoning(other,messages,[]),undefined);
});
test('the latest research stage determines effort; malformed results are ignored', () => {
  assert.equal(researchReasoning(model,messages,[...steps('reading'),...steps('synthesizing')])?.openai.reasoningEffort,'medium');
  assert.equal(researchReasoning(model,messages,[...steps('synthesizing'),{toolResults:[{toolName:'updateResearch',output:{error:'invalid'}}]}])?.openai.reasoningEffort,'medium');
});

test('a plan must be followed by an action before another progress record', () => {
 const names=['updateResearch','openUrl','captureScreen'];
 assert.equal(researchActionTools(names,[]),undefined);
 assert.deepEqual(researchActionTools(names,[{toolCalls:[{toolName:'updateResearch'}]}]),['openUrl','captureScreen']);
 assert.equal(researchActionTools(names,[{toolCalls:[{toolName:'captureScreen'}]}]),undefined);
});

test('combined startup retains research context and cannot be repeated next step', () => {
 assert.equal(researchReasoning(model,messages,[{toolResults:[{toolName:'startResearch',output:{research:{stage:'planning'}}}]}])?.openai.reasoningEffort,'minimal');
 assert.deepEqual(researchActionTools(['startResearch','updateResearch','openUrl'],[{toolCalls:[{toolName:'startResearch'}]}]),['updateResearch','openUrl']);
});
