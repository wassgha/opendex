import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

// Clock — read-only, always on. Reports the current date/time in any IANA zone.
export const clockSkill: Skill = {
  ...meta,
  tools: [
    {
      name: TOOLS.getCurrentTime,
      description:
        "Get the current date and time. Optionally pass an IANA timezone (e.g. 'Europe/London', 'America/New_York'). Defaults to UTC.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe("IANA timezone, e.g. 'Europe/London'. Defaults to UTC."),
      }),
      execute: async ({ timezone }: { timezone?: string }) => {
        const tz = timezone ?? "UTC";
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
