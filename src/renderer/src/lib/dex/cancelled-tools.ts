import type { ToolInvocation } from '../../../../skills/tool-view';

/** Settle only this worker's pending cards; preserve completed history. */
export function cancelPendingTools(tools: ToolInvocation[], ids: ReadonlySet<string>): ToolInvocation[] {
  return tools.map(tool => ids.has(tool.id) && tool.status === 'running'
    ? { ...tool, status: 'error', result: { error: 'Task cancelled; this action did not return a confirmed result.', state: 'cancelled' } }
    : tool);
}
