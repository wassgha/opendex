import type { ZodType } from "zod";
import type { Tool } from "ai";

/** What a tool's `execute` result is transformed into before it reaches the
 *  model — lets a tool hand back an image (e.g. a screenshot) instead of JSON. */
export type ToModelOutput = NonNullable<Tool["toModelOutput"]>;

// A skill bundles one or more related tools the agent can call. Sensitive
// skills run every call through the permission gate (keyed by the skill id).
export interface SkillTool {
  name: string;
  description: string;
  inputSchema: ZodType;
  /** Build a short human-readable summary of a call, shown in the permission prompt. */
  summarize?: (input: unknown) => string;
  execute: (input: never) => Promise<unknown>;
  /** Optional: convert the execute result into model-facing content (e.g. an image). */
  toModelOutput?: ToModelOutput;
}

export interface Skill {
  id: string;
  label: string;
  description: string;
  /** When true, each tool call is gated behind a user permission prompt. */
  sensitive: boolean;
  /** When true, the skill is OFF unless the user explicitly enables it (powerful/risky). */
  optIn?: boolean;
  tools: SkillTool[];
}

/** Asks the user to approve a sensitive action; resolves true if allowed. */
export type PermissionRequester = (
  skillId: string,
  label: string,
  detail: string,
) => Promise<boolean>;
