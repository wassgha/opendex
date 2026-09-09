import type { SkillMeta } from "../types";
export const TOOLS = { updateResearch: "updateResearch" } as const;
export const meta: SkillMeta = {
  id: "research", label: "Research companion",
  description: "Show a research plan, sources, findings, and changes of direction while Dex investigates.",
  sensitive: false,
};
