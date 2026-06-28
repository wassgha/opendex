// Canonical tool names — the single source of truth for the string that links a
// main-process SkillTool (its executable half) to a renderer ToolView (its UI
// half). Dependency-free so both sides can import it (type-only or as values)
// across the process boundary, like config/llm-providers.ts. Renaming a tool
// here is a compile error wherever the constant is used, instead of a silent
// fallback to the generic banner/card.
export const TOOL_NAMES = {
  // clock / weather / web-search skills (carded)
  getCurrentTime: "getCurrentTime",
  getWeather: "getWeather",
  webSearch: "webSearch",
  // open skill (label-only)
  openUrl: "openUrl",
  openApp: "openApp",
  openPath: "openPath",
  // computer skill (label-only)
  captureScreen: "captureScreen",
  click: "click",
  moveMouse: "moveMouse",
  drag: "drag",
  typeText: "typeText",
  pressKeys: "pressKeys",
  scroll: "scroll",
  wait: "wait",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
