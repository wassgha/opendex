import type { DexThemeDef } from "./types";

// Auto-discover every theme: each folder under themes/<id>/index.tsx
// default-exports a DexThemeDef. Drop a new folder with an index.tsx and it
// registers automatically — no edit here. (Vite transforms import.meta.glob;
// the shared chrome in themes/shared/ has no index.tsx so it isn't matched.)
const modules = import.meta.glob<{ default: DexThemeDef }>("./*/index.tsx", {
  eager: true,
});

export const DEX_THEMES: DexThemeDef[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label));

const DEFAULT_THEME_ID = "jarvis";

export function getDexTheme(id: string | undefined): DexThemeDef {
  return (
    DEX_THEMES.find((t) => t.id === id) ??
    DEX_THEMES.find((t) => t.id === DEFAULT_THEME_ID) ??
    DEX_THEMES[0]
  );
}
