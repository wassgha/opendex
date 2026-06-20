// Renderer-safe metadata for built-in skills (the actual skills live in the
// main process and pull in electron/node, so they can't be imported here).
// Keep in sync with src/main/agent/skills/registry.ts BUILTIN_SKILLS.
export interface SkillMeta {
  id: string;
  label: string;
  description: string;
  sensitive: boolean;
  /** Opt-in skills are OFF until the user enables them (powerful/risky). */
  optIn?: boolean;
}

export const SKILLS_META: SkillMeta[] = [
  {
    id: "open",
    label: "Open apps & URLs",
    description: "Open URLs in the browser, launch apps, and open files/folders.",
    sensitive: true,
  },
  {
    id: "computer",
    label: "Control the computer",
    description:
      "Let the assistant see the screen and control the mouse & keyboard to operate apps. Needs Screen Recording + Accessibility permissions.",
    sensitive: true,
    optIn: true,
  },
];
