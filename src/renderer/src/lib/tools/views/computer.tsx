import { TOOL_NAMES } from "../../../../../shared/tool-names";
import { registerToolView } from "../registry";
import { truncate, prettyKey } from "../label-utils";

// The computer skill is label-only — its "result" is a screenshot (stripped to
// a placeholder before it reaches the renderer), so each action surfaces as a
// transient banner during the screenshot→act→screenshot loop, not a card.

registerToolView({
  name: TOOL_NAMES.captureScreen,
  label: (input) =>
    (input as { region?: unknown })?.region
      ? { icon: "🔍", label: "Zooming into the screen" }
      : { icon: "📸", label: "Looking at the screen" },
});

registerToolView({
  name: TOOL_NAMES.click,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    const kind = i.double ? "Double-click" : `${String(i.button ?? "left")}-click`;
    const where = i.x != null && i.y != null ? ` at (${i.x}, ${i.y})` : "";
    return { icon: "🖱️", label: `${kind}${where}` };
  },
});

registerToolView({
  name: TOOL_NAMES.moveMouse,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return { icon: "🖱️", label: `Move cursor to (${i.x}, ${i.y})` };
  },
});

registerToolView({
  name: TOOL_NAMES.drag,
  label: (input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return { icon: "🖱️", label: `Drag to (${i.toX}, ${i.toY})` };
  },
});

registerToolView({
  name: TOOL_NAMES.typeText,
  label: (input) => ({
    icon: "⌨️",
    label: `Type “${truncate(String((input as { text?: unknown })?.text ?? ""))}”`,
  }),
});

registerToolView({
  name: TOOL_NAMES.pressKeys,
  label: (input) => {
    const keys = (input as { keys?: unknown })?.keys;
    const pretty = Array.isArray(keys) ? (keys as string[]).map(prettyKey).join(" ") : "";
    return { icon: "⌨️", label: `Press ${pretty}` };
  },
});

registerToolView({
  name: TOOL_NAMES.scroll,
  label: (input) => ({
    icon: "📜",
    label: `Scroll ${String((input as { direction?: unknown })?.direction ?? "down")}`,
  }),
});

registerToolView({
  name: TOOL_NAMES.wait,
  label: () => ({ icon: "⏳", label: "Waiting for the screen" }),
});
