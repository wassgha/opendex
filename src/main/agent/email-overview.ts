import type { ModelMessage } from 'ai';

export const EMAIL_OVERVIEW_TOOLS = new Set(['openUrl', 'captureScreen', 'captureDisplay', 'zoomScreen', 'scroll', 'wait']);
/** Only a bounded check request, including the first sentence of a delegated task.
 * A separate read/reply request keeps the normal toolset and permission gates. */
export function isEmailOverview(messages: ModelMessage[]): boolean {
  const content = messages.filter(m => m.role === 'user').at(-1)?.content;
  if (typeof content !== 'string') return false;
  const first = content.split(/[.!?\n]/, 1)[0].trim();
  return /^(?:(?:hey\s+)?dex[,\s]+)?check\b.{0,80}\b(?:e-?mails?|gmail|inbox)\b/i.test(first)
    && !/\b(?:read|open|reply|send|forward|delete|archive)\b/i.test(first);
}
