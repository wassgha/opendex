import type { LanguageModel, ModelMessage } from 'ai';
import { START_RESEARCH_TOOL } from "./research-start";
import { TOOLS } from '../../skills/research/meta';

type Step = { toolResults: Array<{ toolName: string; output: unknown }> };
/** Keep GPT-5 research navigation responsive; retain deeper comparison and
 * synthesis. Only the verified direct OpenAI GPT-5 configuration is changed. */
export function researchReasoning(model: LanguageModel, messages: ModelMessage[], steps: Step[]) {
  if (typeof model === 'string' || model.modelId !== 'gpt-5' || !model.provider.startsWith('openai.')) return undefined;
  let stage: string | undefined;
  for (const step of steps) for (const result of step.toolResults) {
    if (![TOOLS.updateResearch, START_RESEARCH_TOOL].includes(result.toolName) || !result.output || typeof result.output !== 'object') continue;
    const output = result.toolName === START_RESEARCH_TOOL ? (result.output as { research?: unknown }).research : result.output;
    const value = (output as { stage?: unknown } | undefined)?.stage;
    if (typeof value === 'string') stage = value;
  }
  const lastUser = messages.filter(m => m.role === 'user').at(-1);
  const requested = typeof lastUser?.content === 'string' && /\b(research|investigate|investigation)\b/i.test(lastUser.content);
  if (!stage && !requested) return undefined;
  return { openai: { reasoningEffort: ['comparing', 'synthesizing', 'complete', 'blocked'].includes(stage ?? '') ? 'medium' : 'minimal' } };
}

/** A progress record is not research. Require an intervening real action
 * before another record update, so the model cannot loop on planning cards. */
export function researchActionTools(names: string[], steps: Array<{toolCalls: Array<{toolName: string}>}>) {
  const calls = steps.at(-1)?.toolCalls ?? [];
  const available = steps.length ? names.filter(name => name !== START_RESEARCH_TOOL) : names;
  if (calls.length && calls.every(call => call.toolName === TOOLS.updateResearch)) return available.filter(name => name !== TOOLS.updateResearch);
  return steps.length && names.includes(START_RESEARCH_TOOL) ? available : undefined;
}
