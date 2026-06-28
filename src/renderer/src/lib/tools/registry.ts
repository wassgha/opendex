import type { ToolView } from "./types";

// Name → ToolView registry (assistant-ui's `by_name` + `Fallback` pattern,
// without the runtime). Views register themselves on import; see ./views.
const VIEWS: Record<string, ToolView> = {};

export function registerToolView(view: ToolView): void {
  VIEWS[view.name] = view;
}

// Resolve a view by tool name. Unknown tools get a label-only fallback (generic
// icon + the raw tool name, no card) — deliberately no auto-JSON card, so an
// unregistered tool surfaces as a banner, not a wall of JSON.
export function getToolView(name: string): ToolView {
  return VIEWS[name] ?? { name, label: () => ({ icon: "⚙️", label: name }) };
}
