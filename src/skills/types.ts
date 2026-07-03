import type { ZodType } from "zod";
import type { Tool } from "ai";

// ── Skill model (shared / main process) ─────────────────────────────────────
// A skill bundles one or more related tools the agent can call. Each skill lives
// in its own folder under src/skills/<name>/ and is self-contained:
//   meta.ts   — id/label/description/sensitivity + tool-name constants (no deps)
//   skill.ts  — the executable Skill (runs in the MAIN process; zod/node/ai)
//   view.tsx  — optional renderer UI: tool labels + result cards (React)
// The two halves are linked only by the tool `name` string, declared once in
// meta.ts and imported by both skill.ts and view.tsx.

/** Renderer-safe skill metadata — drives the Settings "Skills & tools" UI.
 *  Lives in each skill's meta.ts so it carries no node/electron/ai imports. */
export interface SkillMeta {
  id: string;
  label: string;
  description: string;
  /** When true, each tool call is gated behind a user permission prompt. */
  sensitive: boolean;
  /** When true, the skill is OFF unless the user explicitly enables it. */
  optIn?: boolean;
  /** When true, this skill's tools return images (screenshots) to the model.
   *  Realtime speech-to-speech sessions take no image input, so these tools are
   *  never exposed to a realtime session directly — they run inside a delegated
   *  run_task agent instead (see src/main/agent/realtime). */
  imageResults?: boolean;
}

/** What a tool's `execute` result is transformed into before it reaches the
 *  model — lets a tool hand back an image (e.g. a screenshot) instead of JSON. */
export type ToModelOutput = NonNullable<Tool["toModelOutput"]>;

export interface SkillTool {
  name: string;
  description: string;
  inputSchema: ZodType;
  /** Build a short human summary of a call, shown in the permission prompt. */
  summarize?: (input: unknown) => string;
  execute: (input: never) => Promise<unknown>;
  /** Optional: convert the execute result into model-facing content (e.g. an image). */
  toModelOutput?: ToModelOutput;
}

/** The executable skill (main process). Extends its renderer-safe `SkillMeta`
 *  with the actual tools. */
export interface Skill extends SkillMeta {
  tools: SkillTool[];
  /** Optional operating instructions appended to the system prompt when this
   *  skill is enabled (non-briefing turns) — e.g. how to drive computer-use. */
  systemPrompt?: string;
}

/** Asks the user to approve a sensitive action; resolves true if allowed. */
export type PermissionRequester = (
  skillId: string,
  label: string,
  detail: string,
) => Promise<boolean>;
