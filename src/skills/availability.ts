import type { OpenDexConfig } from "../main/config/schema";
import type { Skill, SkillMeta } from "./types";

export function isSkillEnabled(skill: SkillMeta, config: OpenDexConfig): boolean {
  return skill.optIn
    ? config.skills.enabled[skill.id] === true
    : config.skills.enabled[skill.id] !== false;
}

/** Both pipeline and realtime must advertise only enabled, configured skills. */
export function isSkillAvailable(skill: Skill, config: OpenDexConfig): boolean {
  return isSkillEnabled(skill, config) && (skill.isReady?.() ?? true);
}
