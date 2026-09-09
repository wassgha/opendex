import type { SkillMeta } from "../types";

export const TOOLS = { listTricks: "listTricks", chooseTrick: "chooseTrick", showPlayground: "showPlayground" } as const;
export const meta: SkillMeta = {
  id: "tricks", label: "Cool tricks",
  description: "Choose and perform capability demos, including an interactive visual playground.",
  sensitive: false,
};
