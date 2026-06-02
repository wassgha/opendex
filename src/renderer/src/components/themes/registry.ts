import type { DexThemeDef } from "./types";
import { JarvisTheme } from "./jarvis/jarvis-theme";
import { DotTheme } from "./dot-theme";
import { CursorTheme } from "./cursor-theme";

export const DEX_THEMES: DexThemeDef[] = [
  {
    id: "jarvis",
    label: "Jarvis HUD",
    description: "A full Stark-style heads-up display with a reactive arc reactor.",
    Component: JarvisTheme,
  },
  {
    id: "dot",
    label: "Talking Dot",
    description: "A single dot that breathes with your voice. Minimal, monochrome.",
    Component: DotTheme,
  },
  {
    id: "cursor",
    label: "Typing Cursor",
    description: "A blinking terminal caret and a plain-text log. Quiet and focused.",
    Component: CursorTheme,
  },
];

const DEFAULT_THEME_ID = "jarvis";

export function getDexTheme(id: string | undefined): DexThemeDef {
  return (
    DEX_THEMES.find((t) => t.id === id) ??
    DEX_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}
