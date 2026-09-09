/** Project only bounded outcome metadata; never retain arbitrary tool output. */
export function diagnosticToolOutcome(output: unknown): { failed: boolean; outcome?: string; targetId?: string; reason?: string } {
  const value = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const states = new Set(["cancelled", "unarchived", "unconfirmed", "not-submitted", "created-unsubmitted", "rejected", "unsupported", "accepted", "archived", "opened"]);
  const reasons = new Set(['accepted spoken input interrupted the active task', 'voice input interrupted the active task', 'voice connection closed', 'new typed input replaced the active task', 'explicit cancellation requested', 'voice session ended', 'desktop workflow ended']);
  const reason = typeof value.reason === 'string' && reasons.has(value.reason) ? value.reason : toolFailureCode(value);
  return { failed: Boolean(value.error), ...(reason ? { reason } : {}), ...(typeof value.taskId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.taskId) ? { targetId: value.taskId } : {}), ...(typeof value.state === "string" && states.has(value.state) ? { outcome: value.state } : {}) };
}

/** Whitelist diagnostic categories rather than retaining arbitrary error text. */
export function toolFailureCode(value: unknown): string | undefined {
  const object = value && typeof value === 'object' ? value as { code?: unknown; error?: unknown; message?: unknown } : {};
  if (typeof object.code === 'string' && ['browser-research-navigation', 'stale-desktop-frame', 'missing-desktop-frame'].includes(object.code)) return object.code;
  const text = typeof object.error === 'string' ? object.error : typeof object.message === 'string' ? object.message : '';
  if (object.code === 'browser-research-navigation' || text.startsWith('Browser research requires clicking links')) return 'browser-research-navigation';
  if (text.startsWith('The foreground window changed or moved')) return 'stale-desktop-frame';
  if (text.startsWith('Take a fresh screenshot before controlling')) return 'missing-desktop-frame';
  return undefined;
}
