// Renderer-safe metadata for built-in skills (the actual skills live in the
// main process and pull in electron/node, so they can't be imported here).
// Keep in sync with src/main/agent/skills/registry.ts BUILTIN_SKILLS.
export interface SkillMeta {
  id: string;
  label: string;
  description: string;
  sensitive: boolean;
}

export const SKILLS_META: SkillMeta[] = [
  {
    id: "open",
    label: "Open apps & URLs",
    description: "Open URLs in the browser, launch apps, and open files/folders.",
    sensitive: true,
  },
];
