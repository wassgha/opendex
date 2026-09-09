import { beginUsage, finishUsage } from "../../main/usage/ledger";
import { unknownCharge } from "../../main/usage/pricing";
import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

const browserFallback =
  "Only the search API failed; browser search may still be available. Continue the user's request with available browser tools: use openUrl with an encoded Google search URL and its browser option for a named browser on macOS; use run_task for an existing tab or reading results. In a desktop task, use the available computer tools as needed. Do not ask the user to type or paste when you can do it. Respect disabled tools and permission denials; report only what the fallback actually completes.";

// Tavily retrieves information for an answer; it does not operate a browser.
export const webSearchSkill: Skill = {
  ...meta,
  isReady: () => Boolean(process.env.TAVILY_API_KEY?.trim()),
  systemPrompt:
    "Distinguish answering a web question from performing a search in the user's browser. When the conversation is about Chrome, Google, or an open search page, follow-up requests like 'search for something' refer to that browser task. Use available browser controls instead of webSearch. If the user says 'anything' or 'you choose', pick a harmless example query without another clarification. If webSearch is unavailable or fails, continue through available browser tools within the user's request and permissions; do not treat a search-service failure as loss of browser control. Opening results is not evidence that you read them.",
  tools: [
    {
      name: TOOLS.webSearch,
      description:
        "Retrieve live web information for an answer using the Tavily search API. Returns titles, URLs, and snippets. Does not type in or navigate the user's browser. For a search in an open or requested browser, use browser controls instead.",
      inputSchema: z.object({
        query: z.string().describe("The search query."),
      }),
      execute: async ({ query }: { query: string }) => {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return {
            error:
              "The search API is unavailable because its access key is not configured.",
            recovery: browserFallback,
          };
        }
        const usageId = beginUsage({ provider: "tavily", model: "basic", category: "search" });
        try {
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
            finishUsage(usageId, { requests: 1 }, unknownCharge("Search failed without confirmed billing usage."), true);
            return { error: `Search failed: ${res.status} ${res.statusText}`, recovery: browserFallback };
          }
          const data = (await res.json()) as {
            answer?: string;
            results: Array<{ title: string; url: string; content: string }>;
          };
          finishUsage(usageId, { requests: 1, credits: 1 }, unknownCharge("Basic search uses one Tavily credit. Dollar cost depends on your plan and allowance."));
          return {
            answer: data.answer,
            results: data.results.slice(0, 5).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content.slice(0, 400),
            })),
          };
        } catch (error) {
          finishUsage(usageId, { requests: 1 }, unknownCharge("Search ended without confirmed usage."), true);
          throw error;
        }
      },
    },
  ],
};
