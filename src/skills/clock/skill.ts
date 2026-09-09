import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

// Clock — read-only, always on. Reports the current date/time in any IANA zone.
export const clockSkill: Skill = {
  ...meta,
  systemPrompt: "For a request for the time or date without a named place, call getCurrentTime with no timezone argument: it uses the user's computer timezone. Never infer location from your persona, accent, example inputs, or previous unrelated tool calls. Only pass a different timezone when the user requests it.",
  tools: [
    {
      name: TOOLS.getCurrentTime,
      description:
        "Get the current date and time in the user's computer timezone. Omit timezone for local time; override only when the user explicitly requests another place or timezone.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe("Optional IANA timezone, only for an explicitly requested location. Omit for the user's local time."),
      }),
      execute: async ({ timezone }: { timezone?: string }) => {
        const tz = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
        try {
          const now = new Date();
          const formatted = new Intl.DateTimeFormat("en-GB", {
            timeZone: tz,
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(now);
          return { timezone: tz, formatted, iso: now.toISOString() };
        } catch {
          return { error: `Unknown timezone: ${tz}` };
        }
      },
    },
  ],
};
