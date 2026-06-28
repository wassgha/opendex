import type { ToolCallEvent } from "../../../main/ipc/channels";
import { getToolView } from "@skills/tool-views";

export interface ToolActivityLabel {
  icon: string;
  label: string;
}

/** Map a tool call to a short banner label + icon, via the tool-view registry.
 *  (The per-tool label logic now lives with each skill's view.tsx.) */
export function formatToolCall(call: ToolCallEvent): ToolActivityLabel {
  return getToolView(call.toolName).label(call.input);
}
