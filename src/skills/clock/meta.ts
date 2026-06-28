import type { SkillMeta } from "../types";

// Tool names — the contract between skill.ts (executable) and view.tsx (UI).
// Declared once here so both halves import the same string.
export const TOOLS = {
  getCurrentTime: "getCurrentTime",
} as const;

export const meta: SkillMeta = {
  id: "clock",
  label: "Clock",
  description: "Tell the current date and time in any timezone.",
  sensitive: false,
};
