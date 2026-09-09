import { Check, Circle, ExternalLink } from "lucide-react";
import React from "react";
import { TOOLS } from "./meta";
import type { ResearchUpdate } from "./schema";
import { registerToolView } from "../tool-registry";
import type { ToolViewProps } from "../tool-view";

const stages: Record<ResearchUpdate["stage"], string> = {
  planning: "Research plan", searching: "Finding sources", reading: "Reading sources",
  comparing: "Comparing evidence", synthesizing: "Bringing it together", complete: "Research findings", blocked: "Research paused",
};
function safeUrl(url: string) {
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}
export function ResearchCard({ result, status, surface }: ToolViewProps) {
  const data = result as (ResearchUpdate & { error?: string }) | null;
  if (!data || status !== "done" || data.error || !Array.isArray(data.plan)) {
    return <div role="status" className="px-4 py-3 text-sm text-muted-foreground">{data?.error || "Updating the research record…"}</div>;
  }
  const compact = surface !== "main";
  return <section aria-label="Research progress" className={`w-full min-w-0 rounded-xl border border-border bg-card text-card-foreground ${compact ? "h-[220px]" : "max-w-lg"}`}>
    <header className="border-b border-border px-4 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stages[data.stage]}</div>
      <h3 className="truncate text-sm font-semibold" title={data.topic}>{data.topic}</h3>
    </header>
    <div tabIndex={0} aria-label="Plan, sources, and findings" className={`overflow-y-auto overscroll-contain px-4 py-3 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${compact ? "h-[160px]" : "max-h-80"}`}>
      <p role="status" aria-live="polite" className="mb-3 text-sm">{data.update}</p>
      <ol className="space-y-1.5" aria-label="Research plan">
        {data.plan.map((step, i) => <li key={i} className={`flex items-start gap-2 ${step.status === "active" ? "font-medium text-foreground" : "text-muted-foreground"}`}>
          {step.status === "done" ? <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : <Circle aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${step.status === "active" ? "fill-primary/20 text-primary" : ""}`} />}
          <span><span className="sr-only">{step.status}: </span>{step.title}</span>
        </li>)}
      </ol>
      {data.sources.length > 0 && <div className="mt-4">
        <h4 className="mb-2 font-semibold">Sources <span className="font-normal text-muted-foreground">{data.sources.filter(s => s.status === "read").length} read · {data.sources.length} collected</span></h4>
        <ul className="space-y-3">{data.sources.map((source, i) => <li key={`${source.url}-${i}`}>
          <div className="flex items-start justify-between gap-2">
            <a href={safeUrl(source.url)} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.title}<ExternalLink aria-hidden className="ml-1 inline size-3" /></a>
            <span className="shrink-0 text-[10px] text-muted-foreground">{source.status === "read" ? "Read" : source.status === "found" ? "Not yet read" : "Unavailable"}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{source.note}</p>
        </li>)}</ul>
      </div>}
      {data.findings.length > 0 && <div className="mt-4">
        <h4 className="mb-2 font-semibold">What the evidence shows</h4>
        <ul className="space-y-3">{data.findings.map((finding, i) => <li key={i}>
          <p>{finding.text}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{finding.sourceUrls.map(url => <a key={url} href={safeUrl(url)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{data.sources.find(source => source.url === url)?.title ?? "Source"}</a>)}</div>
        </li>)}</ul>
      </div>}
      {data.openQuestions.length > 0 && <div className="mt-4"><h4 className="mb-1 font-semibold">Still uncertain</h4><ul className="list-disc space-y-1 pl-4 text-muted-foreground">{data.openQuestions.map((question, i) => <li key={i}>{question}</li>)}</ul></div>}
    </div>
  </section>;
}
registerToolView({ name: TOOLS.updateResearch, label: input => ({ icon: "🔎", label: String((input as { update?: string })?.update ?? "Updating the research plan") }), Card: ResearchCard, notchHeight: 228 });
