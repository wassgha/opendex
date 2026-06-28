// Auto-register every skill's tool views (labels + result cards) by importing
// each skill folder's view.tsx for its side-effect. Vite's import.meta.glob
// discovers them, so dropping a new skill folder with a view.tsx wires up its
// cards automatically — no edit needed. (Renderer-only; Vite transforms glob.)
import.meta.glob("./*/view.tsx", { eager: true });

export { getToolView } from "./tool-registry";
export type {
  ToolView,
  ToolViewProps,
  ToolSurface,
  ToolStatus,
  ToolInvocation,
} from "./tool-view";
