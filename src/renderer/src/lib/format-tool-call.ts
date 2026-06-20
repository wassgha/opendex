import type { ToolCallEvent } from "../../../main/ipc/channels";

export interface ToolActivityLabel {
  icon: string;
  label: string;
}

function truncate(s: string, n = 48): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

const KEY_SYMBOL: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  super: "⌘",
  win: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  ctrl: "⌃",
  control: "⌃",
  enter: "⏎",
  return: "⏎",
  esc: "⎋",
  escape: "⎋",
};

function prettyKey(k: string): string {
  return KEY_SYMBOL[k.toLowerCase()] ?? k.toUpperCase();
}

/** Map a tool call to a short, human banner label + icon. */
export function formatToolCall(call: ToolCallEvent): ToolActivityLabel {
  const i = (call.input ?? {}) as Record<string, unknown>;
  switch (call.toolName) {
    case "captureScreen":
      return { icon: "📸", label: "Looking at the screen" };
    case "click": {
      const kind = i.double ? "Double-click" : `${String(i.button ?? "left")}-click`;
      return { icon: "🖱️", label: `${kind} at (${i.x}, ${i.y})` };
    }
    case "moveMouse":
      return { icon: "🖱️", label: `Move cursor to (${i.x}, ${i.y})` };
    case "typeText":
      return { icon: "⌨️", label: `Type “${truncate(String(i.text ?? ""))}”` };
    case "pressKeys": {
      const keys = Array.isArray(i.keys) ? (i.keys as string[]).map(prettyKey).join(" ") : "";
      return { icon: "⌨️", label: `Press ${keys}` };
    }
    case "scroll":
      return { icon: "📜", label: `Scroll ${String(i.direction ?? "down")}` };
    case "openUrl":
      return { icon: "🌐", label: `Open ${truncate(String(i.url ?? ""))}` };
    case "openApp":
      return { icon: "🚀", label: `Launch ${String(i.name ?? "")}` };
    case "openPath":
      return { icon: "📂", label: `Open ${truncate(String(i.path ?? ""))}` };
    case "getCurrentTime":
      return { icon: "🕐", label: "Check the time" };
    case "getWeather":
      return { icon: "🌤️", label: `Check weather in ${String(i.location ?? "")}` };
    case "webSearch":
      return { icon: "🔎", label: `Search the web: “${truncate(String(i.query ?? ""))}”` };
    default:
      return { icon: "⚙️", label: call.toolName };
  }
}
