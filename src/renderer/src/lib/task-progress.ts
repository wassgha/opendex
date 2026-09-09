import type { SessionToolInvocation } from "../../../main/ipc/channels";

const labels: Record<string, string> = {
  captureScreen: "Reading the screen", click: "Clicking a control", pressKeys: "Pressing a shortcut",
  typeText: "Entering text", scroll: "Scrolling", wait: "Waiting for the app",
  openApp: "Opening an app", openUrl: "Opening a page", webSearch: "Searching the web",
  read_wake_screen: "Reading the screen", controlDesktop: "Applying desktop control",
  moveMouse: "Moving the pointer", drag: "Dragging a control", getCurrentTime: "Checking the time",
};
export function taskProgress(status: string, tools: SessionToolInvocation[]) {
  if (["idle", "muted", "listening_wake", "error", "unsupported"].includes(status)) return null;
  const task = tools.findLast((tool) => tool.name === "run_task" && tool.status === "running");
  const current = tools.findLast((tool) => tool.name !== "run_task" && tool.status === "running");
  // Voice state changes must not insert/remove a full progress row between
  // input and reply. The existing status indicator covers ordinary thinking.
  if (!task && !current) return null;
  return {
    label: current ? labels[current.name] ?? "Running an action" : "Waiting for the task agent",
    completed: task ? tools.slice(tools.indexOf(task) + 1).filter((tool) => tool.name !== "run_task" && tool.status === "done").length : 0,
  };
}
