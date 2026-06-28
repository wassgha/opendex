import { TOOLS } from "./meta";
import { registerToolView } from "../tool-registry";
import { truncate } from "../label-utils";
import type { ToolViewProps } from "../tool-view";

// Shape returned by the web-search skill's webSearch tool.
interface SearchResult {
  answer?: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// A search result card: the synthesized answer (when present) over the top
// sources. Theme-token styled. On the notch it collapses to a compact card.
function SearchCard({ input, result, status, surface }: ToolViewProps) {
  const data = result as SearchResult | null;
  const query = String((input as { query?: unknown })?.query ?? "");

  if (!data || status !== "done" || data.error) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur">
        {data?.error ?? `Searching the web${query ? ` for “${truncate(query)}”` : ""}…`}
      </div>
    );
  }

  if (surface === "notch" || surface === "overlay") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-foreground">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span aria-hidden>🔎</span>
          <span className="truncate">{truncate(query, 36)}</span>
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-foreground/90">
          {data.answer ?? `${data.results.length} results found.`}
        </p>
      </div>
    );
  }

  const top = data.results.slice(0, 3);
  return (
    <div className="w-full max-w-sm rounded-3xl border border-border bg-card/90 p-4 text-card-foreground shadow-sm backdrop-blur">
      {data.answer && (
        <p className="mb-3 text-sm leading-relaxed text-card-foreground/90">{data.answer}</p>
      )}
      <ul className="flex flex-col gap-2">
        {top.map((r) => (
          <li key={r.url} className="min-w-0">
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium text-primary hover:underline"
            >
              {r.title}
            </a>
            <span className="text-xs text-muted-foreground">{domainOf(r.url)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

registerToolView({
  name: TOOLS.webSearch,
  label: (input) => ({
    icon: "🔎",
    label: `Search the web: “${truncate(String((input as { query?: unknown })?.query ?? ""))}”`,
  }),
  Card: SearchCard,
});
