// Public entry for the tool-view system. Importing this registers all built-in
// views (side-effect) and re-exports the resolver + types.
import "./views";

export { getToolView } from "./registry";
export type { ToolView, ToolViewProps, ToolSurface, ToolStatus } from "./types";
