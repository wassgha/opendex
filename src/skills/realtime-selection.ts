import type { Skill, SkillTool } from "./types";

export function isDirectTool(tool: SkillTool, skill: Skill): boolean {
  return !skill.imageResults || tool.realtime === true;
}

export function directSkill(skill: Skill): Skill {
  return { ...skill, tools: skill.tools.filter((tool) => isDirectTool(tool, skill)),
    // The visual manual requires screenshots; it doesn't apply to direct controls.
    systemPrompt: skill.imageResults ? undefined : skill.systemPrompt };
}
