import type { SkillMeta } from "./types";

// Renderer-safe skill metadata, auto-discovered from every skill folder's
// meta.ts (dependency-free, so this never pulls node/ai into the renderer
// bundle). Drives the Settings "Skills & tools" UI. Drop a new skill folder
// with a meta.ts and it appears here automatically — no edit needed.
const modules = import.meta.glob<{ meta: SkillMeta }>("./*/meta.ts", {
  eager: true,
});

export const SKILL_METAS: SkillMeta[] = Object.values(modules)
  .map((m) => m.meta)
  .sort((a, b) => a.label.localeCompare(b.label));
