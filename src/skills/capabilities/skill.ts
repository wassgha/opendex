import { z } from "zod";
import { meta } from "./meta";
import type { Skill } from "../types";
import { capabilityInventory } from "../../main/maintenance/capabilities";
export const capabilitiesSkill: Skill = {
  ...meta,
  tools: [{
    name: "checkDexCapabilities",
    description: "Inspect Dex's actual tool inventory and access states before declaring a request impossible or proposing self-enhancement. This does not execute tools or verify external services. Interpret the user's desired outcome against these tool descriptions, including combinations of existing tools.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      if (!context) return { error: "Capability context is unavailable." };
      const { BUILTIN_SKILLS } = await import("../registry");
      return { capabilities: capabilityInventory(BUILTIN_SKILLS, context.config),
        guidance: "Available means configured, not live-verified. Try a suitable existing tool. Disabled, denied, missing credentials, and connection failures are not proof of a missing feature. Never bypass a denial by implementing another route." };
    },
  }],
};
