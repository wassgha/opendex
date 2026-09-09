import type { ModelMessage, ToolSet } from 'ai';

export const BROWSER_RESEARCH_RULE = `During browser research, source links must be visibly present in the browser and reached by clicking those links. Never invent a source URL, copy a link address, paste a URL, type a source address, or use openUrl to navigate directly to a source, even if its address appeared in search output or is remembered. Start with a search query, inspect the browser, and click visible search results or links on pages. Use the browser's search box for later searches or change search engine as useful. Do not use search-API output as a substitute for links displayed in the browser. Record source URLs for citations after visiting them; recording a citation is not permission to navigate to it. If a link fails, return to the visible results and click another result. Never guess a replacement path.`;

export function isBrowserResearch(messages: ModelMessage[]) {
  const latest = messages.filter(m => m.role === 'user').at(-1)?.content;
  return typeof latest === 'string' && /\b(research|investigat(?:e|ion)|compare|comparison)\b/i.test(latest);
}

/** Only query-based search entry points may be opened directly. No redirect
 * endpoints, fragments, credentials, alternate ports, or extra query fields. */
export function isSearchEntry(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const paths: Record<string, string> = { 'www.google.com':'/search', 'www.bing.com':'/search', 'duckduckgo.com':'/' };
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      paths[url.hostname] === url.pathname && Boolean(url.searchParams.get('q')?.trim()) &&
      [...url.searchParams.keys()].every(key => key === 'q');
  } catch { return false; }
}

/** Preserve each underlying tool's permission wrapper; refuse URL-navigation
 * shortcuts before it runs. UI-grounded clicking remains the model's duty. */
export function withBrowserResearchPolicy(tools: ToolSet | undefined, initiallyActive: boolean, isBenchmarkUrl: (url: unknown) => boolean = () => false) {
  if (!tools) return tools;
  let active = initiallyActive;
  return Object.fromEntries(Object.entries(tools).map(([name, original]) => {
    if (!original.execute) return [name, original];
    return [name, { ...original, execute: async (input: unknown, options: Parameters<NonNullable<typeof original.execute>>[1]) => {
      if (name === 'updateResearch' || name === 'startResearch') active = true;
      if (active) {
        const args = input as {url?: unknown; text?: unknown; keys?: unknown};
        const keys = Array.isArray(args?.keys) ? args.keys.map(String).map(k => k.toLowerCase()) : [];
        const clipboard = name === 'pressKeys' && keys.some(k => /^(cmd|command|meta|ctrl|control|super|leftsuper|leftcontrol)$/.test(k)) && keys.some(k => ['c','v','keyc','keyv'].includes(k));
        const typedUrl = name === 'typeText' && typeof args?.text === 'string' && /https?:\/\/|www\.|^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:\s]|$)/i.test(args.text.trim());
        // A currently main-owned fixture is not a research source. Only its exact
        // entry URL may use openUrl; still call the original permission wrapper.
        if ((name === 'openUrl' && !isSearchEntry(args?.url) && !isBenchmarkUrl(args?.url)) || name === 'webSearch' || clipboard || typedUrl) {
          return { code: 'browser-research-navigation', error: 'Browser research requires clicking links visible on the page. Inspect the browser and click the source link; do not copy, paste, type, or directly open source URLs. Search queries and the exact active benchmark entry URL through openUrl are allowed.' };
        }
      }
      return original.execute!(input, options);
    } }];
  })) as ToolSet;
}
