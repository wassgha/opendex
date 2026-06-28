import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

// Web search — read-only, always on. Backed by Tavily; returns a spoken-friendly
// error if no TAVILY_API_KEY is configured (so the agent can explain, not crash).
export const webSearchSkill: Skill = {
  ...meta,
  tools: [
    {
      name: TOOLS.webSearch,
      description:
        "Search the live web for current information, news, facts, or anything that may have changed since training. Returns a list of relevant results with titles, URLs, and snippets.",
      inputSchema: z.object({
        query: z.string().describe("The search query."),
      }),
      execute: async ({ query }: { query: string }) => {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return {
            error:
              "Web search is unavailable — the operator has not configured a TAVILY_API_KEY.",
          };
        }
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: true,
          }),
        });
        if (!res.ok) {
          return { error: `Search failed: ${res.status} ${res.statusText}` };
        }
        const data = (await res.json()) as {
          answer?: string;
          results: Array<{ title: string; url: string; content: string }>;
        };
        return {
          answer: data.answer,
          results: data.results.slice(0, 5).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content.slice(0, 400),
          })),
        };
      },
    },
  ],
};
