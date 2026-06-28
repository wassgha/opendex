import type { SkillMeta } from "../types";

export const TOOLS = {
  openUrl: "openUrl",
  openApp: "openApp",
  openPath: "openPath",
} as const;

export const meta: SkillMeta = {
  id: "open",
  label: "Open apps & URLs",
  description: "Open URLs in the browser, launch apps, and open files/folders.",
  sensitive: true,
};
