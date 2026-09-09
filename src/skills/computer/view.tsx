import { TOOLS } from "./meta";
import { registerToolView } from "../tool-registry";
import { truncate, prettyKey } from "../label-utils";

// The computer skill is label-only — its "result" is a screenshot (stripped to
// a placeholder before it reaches the renderer), so each action surfaces as a
// transient banner during the screenshot→act→screenshot loop, not a card.

registerToolView({
  name: TOOLS.controlDesktop,
  label: (input) => {
    const action = (input as { action?: string } | null)?.action ?? '';
    const labels: Record<string, string> = {
      minimize: 'Minimizing the window',
      restore: 'Restoring the window',
      maximize: 'Expanding the window',
      toggle_fullscreen: 'Switching full screen',
      volume_up: 'Turning the volume up',
      volume_down: 'Turning the volume down',
      volume_mute: 'Toggling sound',
    };
    return { icon: action.startsWith('volume_') ? '🔊' : '🖥️', label: labels[action] ?? 'Adjusting the desktop' };
  },
});

registerToolView({
  name: TOOLS.captureScreen,
  label: (input) =>
    (input as { region?: unknown })?.region
      ? { icon: "🔍", label: "Zooming into the screen" }
      : { icon: "📸", label: "Looking at the screen" },
});

registerToolView({
  name: TOOLS.zoomScreen,
  label: () => ({ icon: "🔍", label: "Zooming into the screen" }),
});
registerToolView({
  name: TOOLS.captureDisplay,
  label: () => ({ icon: "📸", label: "Looking at the selected display" }),
});

registerToolView({
  name: TOOLS.click,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    const kind = i.double ? "Double-click" : `${String(i.button ?? "left")}-click`;
    const where = i.x != null && i.y != null ? ` at (${i.x}, ${i.y})` : "";
    return { icon: "🖱️", label: `${kind}${where}` };
  },
});

registerToolView({
  name: TOOLS.moveMouse,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return { icon: "🖱️", label: `Move cursor to (${i.x}, ${i.y})` };
  },
});

registerToolView({
  name: TOOLS.drag,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return { icon: "🖱️", label: `Drag to (${i.toX}, ${i.toY})` };
  },
});

registerToolView({
  name: TOOLS.typeText,
  label: (input) => ({
    icon: "⌨️",
    label: `Type “${truncate(String((input as { text?: unknown })?.text ?? ""))}”`,
  }),
});

registerToolView({
  name: TOOLS.pressKeys,
  label: (input) => {
    const keys = (input as { keys?: unknown })?.keys;
    const pretty = Array.isArray(keys) ? (keys as string[]).map(prettyKey).join(" ") : "";
    return { icon: "⌨️", label: `Press ${pretty}` };
  },
});

registerToolView({
  name: TOOLS.scroll,
  label: (input) => ({
    icon: "📜",
    label: `Scroll ${String((input as { direction?: unknown })?.direction ?? "down")}`,
  }),
});

registerToolView({
  name: TOOLS.wait,
  label: () => ({ icon: "⏳", label: "Waiting for the screen" }),
});

registerToolView({ name: TOOLS.describeScreen, label: () => ({ icon: "🔍", label: "Reading your screen" }) });
