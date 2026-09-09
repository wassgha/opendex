import type { SkillMeta } from "../types";
export const TOOLS = { controlLocalAgentSession: "controlLocalAgentSession", verifyLocalAgentTaskArchive: "verifyLocalAgentTaskArchive", archiveLocalAgentTask: "archiveLocalAgentTask", createLocalAgentTask: "createLocalAgentTask", sendLocalAgentMessage: "sendLocalAgentMessage", openLocalAgentTask: "openLocalAgentTask" } as const;
export const meta: SkillMeta = {
  id: "local-agent-actions", label: "Local agent actions",
  description: "Archive idle Codex tasks, open tasks, send prompts to running or idle agents, and create new tasks in a selected local folder. Prompts can cause agents to change files using their own permissions.",
  sensitive: true, optIn: true,
};
