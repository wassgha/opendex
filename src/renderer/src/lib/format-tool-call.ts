import { RUN_TASK_TOOL, type ToolCallEvent } from "../../../main/ipc/channels";
import { getToolView } from "@skills/tool-views";

export interface ToolActivityLabel {
  icon: string;
  label: string;
}

/** Map a tool call to a short banner label + icon, via the tool-view registry.
 *  (The per-tool label logic now lives with each skill's view.tsx.) */
export function formatToolCall(call: ToolCallEvent): ToolActivityLabel {
  // run_task isn't a skill — it's the realtime session's delegation tool. Its
  // input is the full task prompt, so never surface it: keep the label fixed.
  if (call.toolName === RUN_TASK_TOOL) {
    return { icon: "🛠️", label: "Working on it…" };
  }
  if (call.toolName === 'read_wake_screen') return { icon: '📸', label: 'Looking at the screen' };
  if (call.toolName === 'go_to_sleep') return { icon: '🌙', label: 'Going to sleep' };
  return getToolView(call.toolName).label(call.input);
}
