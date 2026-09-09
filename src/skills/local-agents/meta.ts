import type { SkillMeta } from "../types";
export const TOOLS = { listLocalAgentProjects: "listLocalAgentProjects", listLocalAgents: "listLocalAgents", readLocalAgentTask: "readLocalAgentTask", getLocalAgentOperation: "getLocalAgentOperation" } as const;
export const meta: SkillMeta = {
  id: "local-agents", label: "Local coding agents",
  description: "Read local Codex desktop task titles, status, selected conversation messages, and delivery receipts. Does not send prompts.",
  sensitive: true, optIn: true,
};
