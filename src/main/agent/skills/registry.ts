import { tool, type ToolSet } from "ai";
import { tools as baseTools } from "../tools";
import { openSkill } from "./open";
import { computerSkill } from "./computer";
import type { OpenDexConfig } from "../../config/schema";
import type { PermissionRequester, Skill } from "./types";

// Built-in skills available to the agent.
export const BUILTIN_SKILLS: Skill[] = [openSkill, computerSkill];

/** Whether a skill is active for this config (opt-in skills default OFF). */
export function isSkillEnabled(skill: Skill, config: OpenDexConfig): boolean {
  return skill.optIn
    ? config.skills.enabled[skill.id] === true
    : config.skills.enabled[skill.id] !== false;
}

export interface SkillMeta {
  id: string;
  label: string;
  description: string;
  sensitive: boolean;
  optIn?: boolean;
}

export const SKILL_META: SkillMeta[] = BUILTIN_SKILLS.map((s) => ({
  id: s.id,
  label: s.label,
  description: s.description,
  sensitive: s.sensitive,
  optIn: s.optIn,
}));

/**
 * Assemble the tool set for a chat turn: the always-on base read-only tools
 * plus every enabled skill's tools. Sensitive skills' tools are wrapped so each
 * call passes through the permission gate first.
 */
export function buildToolSet({
  config,
  requestPermission,
}: {
  config: OpenDexConfig;
  requestPermission: PermissionRequester;
}): ToolSet {
  const set: ToolSet = { ...baseTools };

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
