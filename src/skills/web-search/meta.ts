import type { SkillMeta } from "../types";

export const TOOLS = {
  webSearch: "webSearch",
} as const;

export const meta: SkillMeta = {
  id: "web-search",
  label: "Web search",
  description: "Search the live web for current information, news, and facts.",
  sensitive: false,
};
