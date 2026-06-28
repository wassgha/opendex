import { tool, type ToolSet } from "ai";
import { clockSkill } from "./clock/skill";
import { weatherSkill } from "./weather/skill";
import { webSearchSkill } from "./web-search/skill";
import { openSkill } from "./open/skill";
import { computerSkill } from "./computer/skill";
import type { OpenDexConfig } from "../main/config/schema";
import type { PermissionRequester, Skill, SkillMeta } from "./types";

// Built-in skills available to the agent. To add a skill: create a folder under
// src/skills/<name>/ (meta.ts + skill.ts [+ view.tsx]) and add one line here.
// (Explicit, not glob, so `pnpm smoke:chat` runs the registry under tsx — which
// doesn't transform import.meta.glob.) See CONTRIBUTING.md.
export const BUILTIN_SKILLS: Skill[] = [
  clockSkill,
  weatherSkill,
  webSearchSkill,
  openSkill,
  computerSkill,
];

/** Renderer-safe metadata, derived from the built-ins (main-process use only;
 *  the renderer reads metas via its own glob — see ./metas). */
export const SKILL_METAS: SkillMeta[] = BUILTIN_SKILLS.map((s) => ({
  id: s.id,
  label: s.label,
  description: s.description,
  sensitive: s.sensitive,
  optIn: s.optIn,
}));

/** Whether a skill is active for this config (opt-in skills default OFF). */
export function isSkillEnabled(skill: SkillMeta, config: OpenDexConfig): boolean {
  return skill.optIn
    ? config.skills.enabled[skill.id] === true
    : config.skills.enabled[skill.id] !== false;
}

/** Operating-instruction addenda contributed by the enabled skills, appended to
 *  the system prompt on non-briefing turns (e.g. the computer-use manual). */
export function skillSystemPrompts(config: OpenDexConfig): string[] {
  return BUILTIN_SKILLS.filter((s) => isSkillEnabled(s, config))
    .map((s) => s.systemPrompt)
    .filter((p): p is string => Boolean(p));
}

/**
 * Assemble the tool set for a chat turn: every enabled skill's tools. Sensitive
 * skills' tools are wrapped so each call passes through the permission gate first.
 */
export function buildToolSet({
  config,
  requestPermission,
}: {
  config: OpenDexConfig;
  requestPermission: PermissionRequester;
}): ToolSet {
  const set: ToolSet = {};

  for (const skill of BUILTIN_SKILLS) {
    if (!isSkillEnabled(skill, config)) continue;
    for (const t of skill.tools) {
      set[t.name] = tool({
        description: t.description,
        inputSchema: t.inputSchema,
        toModelOutput: t.toModelOutput,
        execute: skill.sensitive
          ? async (input: unknown) => {
              const detail = t.summarize ? t.summarize(input) : t.name;
              const allowed = await requestPermission(skill.id, skill.label, detail);
              if (!allowed) return { error: "Permission denied by the user." };
              return t.execute(input as never);
            }
          : async (input: unknown) => t.execute(input as never),
      });
    }
  }

  return set;
}
