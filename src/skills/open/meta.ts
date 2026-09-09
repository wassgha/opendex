import type { SkillMeta } from "../types";

export const TOOLS = {
  codeWalkthrough: "codeWalkthrough",
  openDexSource: "openDexSource",
  openUrl: "openUrl",
  openApp: "openApp",
  quitApp: "quitApp",
  openPath: "openPath",
} as const;

export const meta: SkillMeta = {
  id: "open",
  label: "Open apps & URLs",
  description: "Open URLs, launch or quit apps, and open files/folders.",
  sensitive: true,
};
