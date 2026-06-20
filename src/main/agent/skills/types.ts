import type { ZodType } from "zod";

// A skill bundles one or more related tools the agent can call. Sensitive
// skills run every call through the permission gate (keyed by the skill id).
export interface SkillTool {
  name: string;
  description: string;
  inputSchema: ZodType;
  /** Build a short human-readable summary of a call, shown in the permission prompt. */
  summarize?: (input: unknown) => string;
  execute: (input: never) => Promise<unknown>;
}

export interface Skill {
  id: string;
  label: string;
  description: string;
  /** When true, each tool call is gated behind a user permission prompt. */
  sensitive: boolean;
  tools: SkillTool[];
}

/** Asks the user to approve a sensitive action; resolves true if allowed. */
export type PermissionRequester = (
  skillId: string,
  label: string,
  detail: string,
) => Promise<boolean>;
