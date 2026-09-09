import type { SkillMeta } from "../types";
export const TOOLS = { diagnoseDex: "diagnoseDex" } as const;
export const meta: SkillMeta = {
  id: "diagnostics", label: "Dex diagnostics",
  description: "Inspect Dex's runtime, permissions, and aggregate interaction failures. Shares no raw transcripts or logs with the model.",
  sensitive: true, optIn: true,
};
