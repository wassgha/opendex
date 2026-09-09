import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { researchSchema } from '../../skills/research/schema';

export const START_RESEARCH_TOOL = 'startResearch';
export function researchSearchUrl(query: string, engine: 'google' | 'bing' | 'duckduckgo' = 'google') {
  const base = { google: 'https://www.google.com/search', bing: 'https://www.bing.com/search', duckduckgo: 'https://duckduckgo.com/' }[engine];
  const url = new URL(base); url.searchParams.set('q', query); return url.href;
}
type Call = { toolCallId: string; toolName: string; input: unknown };
type Result = { toolCallId: string; toolName: string; output: unknown };

/** Compose the existing wrapped tools: showing a plan grants no URL permission. */
export function withResearchStart(tools: ToolSet | undefined, events: {
  onToolCall?: (call: Call) => void; onToolResult?: (result: Result) => void;
}): ToolSet | undefined {
  const research = tools?.updateResearch;
  const open = tools?.openUrl;
  if (!research?.execute || !open?.execute) return tools;
  return { ...tools, [START_RESEARCH_TOOL]: tool({
    description: 'Start new research by displaying a plan and opening its first search query in one action. Choose both now; no extra model turn is needed between them. Uses the existing URL permission check. Opening does not read the page or complete research. Do not use for a user-supplied source URL, a specified existing tab, or when continuing a supplied plan: use the existing browser tools directly.',
    inputSchema: z.object({
      plan: z.object({
        topic: z.string().trim().min(1).max(160),
        steps: z.array(z.string().trim().min(1).max(160)).min(2).max(5),
        update: z.string().trim().min(1).max(600),
        openQuestions: z.array(z.string().trim().min(1).max(300)).max(4),
      }),
      firstPage: z.object({
        query: z.string().trim().min(1).max(400).describe('A focused initial search query. Do not invent an article URL.'),
        engine: z.enum(['google', 'bing', 'duckduckgo']).optional(),
        browser: z.string().trim().min(1).optional().describe('The requested browser, if any. Do not substitute a different browser.'),
      }),
    }),
    execute: async ({ plan, firstPage }, options) => {
      const run = async (name: 'updateResearch' | 'openUrl', input: unknown) => {
        const toolCallId = `${options.toolCallId}:${name}`;
        options.abortSignal?.throwIfAborted();
        events.onToolCall?.({ toolCallId, toolName: name, input });
        try {
          options.abortSignal?.throwIfAborted();
          const output = await tools![name].execute!(input, { ...options, toolCallId });
          events.onToolResult?.({ toolCallId, toolName: name, output });
          return output;
        } catch (error) {
          events.onToolResult?.({ toolCallId, toolName: name, output: { error: 'The startup action did not complete.' } });
          throw error;
        }
      };
      const record = researchSchema.parse({
        topic: plan.topic, plan: plan.steps.map((title, i) => ({ title, status: i === 0 ? 'active' : 'pending' })),
        update: plan.update, openQuestions: plan.openQuestions,
        stage: 'planning', milestone: 'plan', sources: [], findings: [],
      });
      const research = await run('updateResearch', record);
      if (research && typeof research === 'object' && 'error' in research) return { research };
      const navigation = await run('openUrl', { url: researchSearchUrl(firstPage.query, firstPage.engine), ...(firstPage.browser ? { browser: firstPage.browser } : {}) });
      return { research, navigation, note: 'Inspect the browser result next. No source has been read by this action.' };
    },
  }) };
}
