import type { OpenDexConfig } from "../config/schema";
import type { Skill } from "../../skills/types";
import { isSkillEnabled } from "../../skills/availability";

/** Inventory is evidence of configuration, never proof an external service works. */
export function capabilityInventory(skills: readonly Skill[], config: OpenDexConfig) {
  return skills.map(skill => ({
    id: skill.id, label: skill.label, description: skill.description,
    state: !isSkillEnabled(skill, config) ? "disabled"
      : config.skills.permissions[skill.id] === "never" ? "denied"
      : !(skill.isReady?.() ?? true) ? "unavailable" : "available",
    permission: skill.sensitive ? config.skills.permissions[skill.id] ?? "ask" : "not-required",
    tools: skill.tools.map(t => ({ name: t.name, description: t.description,
      execution: skill.imageResults && !t.realtime ? "pipeline-or-delegated" : "direct" })),
  }));
}
