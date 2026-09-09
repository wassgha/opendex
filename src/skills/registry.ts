import { tool, type ToolSet } from "ai";
import { benchmarkSkill } from "./benchmark/skill";
import { capabilitiesSkill } from "./capabilities/skill";
import { gitSkill } from "./git/skill";
import { selfEnhancementSkill } from "./self-enhancement/skill";
import { clockSkill } from "./clock/skill";
import { weatherSkill } from "./weather/skill";
import { webSearchSkill } from "./web-search/skill";
import { openSkill } from "./open/skill";
import { computerSkill } from "./computer/skill";
import { recordingSkill } from "./recording/skill";
import { tricksSkill } from "./tricks/skill";
import { researchSkill } from "./research/skill";
import { diagnosticsSkill } from "./diagnostics/skill";
import { localAgentActionsSkill } from "./local-agent-actions/skill";
import { localAgentsSkill } from "./local-agents/skill";
import type { OpenDexConfig } from "../main/config/schema";
import type { PermissionRequester, Skill, SkillMeta, SkillExecutionContext } from "./types";
import { isSkillAvailable } from "./availability";
export { isSkillEnabled, isSkillAvailable } from "./availability";

// Built-in skills available to the agent. To add a skill: create a folder under
// src/skills/<name>/ (meta.ts + skill.ts [+ view.tsx]) and add one line here.
// (Explicit, not glob, so `pnpm smoke:chat` runs the registry under tsx — which
// doesn't transform import.meta.glob.) See CONTRIBUTING.md.
export const BUILTIN_SKILLS: Skill[] = [
  benchmarkSkill,
  capabilitiesSkill,
  gitSkill,
  selfEnhancementSkill,
  clockSkill,
  weatherSkill,
  webSearchSkill,
  openSkill,
  computerSkill,
  tricksSkill,
  recordingSkill,
  researchSkill,
  diagnosticsSkill,
  localAgentsSkill,
  localAgentActionsSkill,
];

/** Renderer-safe metadata, derived from the built-ins (main-process use only;
 *  the renderer reads metas via its own glob — see ./metas). */
export const SKILL_METAS: SkillMeta[] = BUILTIN_SKILLS.map((s) => ({
  id: s.id,
  label: s.label,
  description: s.description,
  sensitive: s.sensitive,
  optIn: s.optIn,
  imageResults: s.imageResults,
}));

/** Operating-instruction addenda contributed by the enabled skills, appended to
 *  the system prompt on non-briefing turns (e.g. the computer-use manual). */
export function skillSystemPrompts(config: OpenDexConfig, include?: (skill: Skill) => boolean): string[] {
  return BUILTIN_SKILLS.filter((s) => isSkillAvailable(s, config) && (!include || include(s)))
    .map((s) => s.systemPrompt)
    .filter((p): p is string => Boolean(p));
}

/**
 * Assemble the tool set for a chat turn: every enabled skill's tools. Sensitive
 * skills' tools are wrapped so each call passes through the permission gate
 * first. `include` narrows the set further (realtime sessions pass only their
 * direct, non-image skills).
 */
export function buildToolSet({
  config,
  requestPermission,
  include,
  includeTool,
  signal,
}: {
  config: OpenDexConfig;
  signal?: AbortSignal;
  requestPermission: PermissionRequester;
  include?: (skill: Skill) => boolean;
  includeTool?: (tool: Skill["tools"][number], skill: Skill) => boolean;
}): ToolSet {
  const set: ToolSet = {};
  const context: SkillExecutionContext = {
    config,
    signal,
    availableSkillIds: BUILTIN_SKILLS.filter(s => isSkillAvailable(s, config) && config.skills.permissions[s.id] !== "never").map(s => s.id),
    platform: process.platform,
  };

  for (const skill of BUILTIN_SKILLS) {
    if (!isSkillAvailable(skill, config)) continue;
    if (include && !include(skill)) continue;
    for (const t of skill.tools) {
      if (includeTool && !includeTool(t, skill)) continue;
      set[t.name] = tool({
        description: t.description,
        inputSchema: t.inputSchema,
        toModelOutput: t.toModelOutput,
        execute: skill.sensitive
          ? async (input: unknown) => {
              signal?.throwIfAborted();
              const detail = t.summarize ? t.summarize(input) : t.name;
              const allowed = await requestPermission(skill.id, skill.label, detail, { confirmEachCall: t.confirmEachCall });
              signal?.throwIfAborted();
              if (!allowed) return { error: "Permission denied by the user." };
              return t.execute(input as never, context);
            }
          : async (input: unknown) => { signal?.throwIfAborted(); return t.execute(input as never, context); },
      });
    }
  }

  return set;
}
