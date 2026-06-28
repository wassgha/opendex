import type { SkillMeta } from "../types";

export const TOOLS = {
  getWeather: "getWeather",
} as const;

export const meta: SkillMeta = {
  id: "weather",
  label: "Weather",
  description: "Look up the current weather and a brief forecast for a place.",
  sensitive: false,
};
