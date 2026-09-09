import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { money, totalLabel, useUsage } from "@/lib/use-usage";
import type { UsageCategory, UsageHistory, UsageRecord, UsageSummary, UsageTotal } from "../../../../main/usage/types";

const categories: Record<UsageCategory, string> = { conversation: "Conversation & task steps", realtime: "Realtime voice", screen: "Screen analysis", transcription: "Transcription", speech: "Speech generation", search: "Web search", "external-agent": "External agent" };
const providers: Record<string, string> = { gateway: "Vercel AI Gateway", openai: "OpenAI", anthropic: "Anthropic", xai: "xAI", apple: "Apple Intelligence", elevenlabs: "ElevenLabs", tavily: "Tavily", codex: "Codex" };
const units: Record<string, string> = { inputTokens: "Input tokens", outputTokens: "Output tokens", cachedTokens: "Cached input tokens", cacheWriteTokens: "Cache write tokens", audioInputTokens: "Audio input tokens", audioOutputTokens: "Audio output tokens", cachedAudioTokens: "Cached audio tokens", seconds: "Audio seconds", characters: "Characters", credits: "Credits", requests: "Requests" };
function providerGroups(connections: UsageSummary["connections"]) {
  const groups = new Map<string, { provider: string; total: UsageTotal; activities: UsageSummary["connections"] }>();
  for (const connection of connections) {
    let group = groups.get(connection.provider);
    if (!group) {
      group = { provider: connection.provider, total: { usd: 0, reported: 0, estimated: 0, unavailable: 0, pending: 0, requests: 0 }, activities: [] };
      groups.set(connection.provider, group);
    }
    group.activities.push(connection);
    for (const key of Object.keys(group.total) as Array<keyof UsageTotal>) group.total[key] += connection.total[key];
  }
  return [...groups.values()].sort((a, b) => b.total.usd - a.total.usd);
}
function activityLabel(model: string) {
  if (model === "realtime input transcription") return "Input transcription";
  return model.includes("realtime") ? "Realtime voice" : model;
}
function chargeLabel(row: UsageRecord) {
  if (row.status === "pending") return "Pending";
  if (row.usd === null) return "Cost unknown";
  return `${row.confidence === "estimated" ? "≈ " : ""}${money(row.usd)}`;
}
export function UsageSection() {
  const { data, error, refresh } = useUsage();
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    setHistoryError(false);
    void window.opendex.usageHistory(offset).then(value => { if (active) setHistory(value); }).catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [offset, data?.updatedAt]);
  if (!data) return <div className="text-sm text-muted-foreground" role="status">{error ?? "Loading your spending history…"}{error && <Button variant="outline" className="ml-2" onClick={refresh}>Retry</Button>}</div>;
  return <>
    <p className="text-sm leading-relaxed text-muted-foreground">Dex usage on this device, in USD. Totals include estimates and exclude unpriced usage, subscriptions, taxes, and activity in other apps.</p>
    {error && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">{error}<Button variant="outline" onClick={refresh}>Retry</Button></div>}
    <dl className="divide-y divide-border border-y border-border">
      {([['Since launch', data.launch], ['Today', data.today], ['This month', data.month], ['Total tracked', data.all]] as const).map(([label, total]) => <div key={label} className="flex items-baseline justify-between gap-4 py-3">
        <dt className="text-sm">{label}</dt><dd className="text-base font-medium tabular-nums">{totalLabel(total)}</dd>
      </div>)}
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">≈ Estimated using list prices. + Additional usage is pending or unpriced. Since launch starts when Dex opens; voice reconnects do not reset it. {data.since ? `History begins ${new Date(data.since).toLocaleString()}.` : "Tracking begins with your next request."}</p>
    {(data.all.unavailable > 0 || data.all.pending > 0) && <p role="status" className="rounded-md border border-border p-3 text-sm">{data.all.unavailable} request{data.all.unavailable === 1 ? "" : "s"} without a dollar cost · {data.all.pending} pending. These requests can still incur charges. Open a history entry for details.</p>}

    <h3 className="mt-3 text-sm font-semibold">Connections · all tracked usage</h3>
    {data.connections.length === 0 ? <p className="text-sm text-muted-foreground">Your providers will appear here as you use Dex. Local voice engines have no API charge.</p> : <div className="overflow-x-auto">
      <table aria-label="Usage by provider" className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="pb-2 font-normal">Provider / activity</th><th scope="col" className="pb-2 pr-3 text-right font-normal">Requests</th><th scope="col" className="pb-2 text-right font-normal">Known cost</th></tr></thead>
        {providerGroups(data.connections).map(group => <tbody key={group.provider} className="border-t border-border">
          <tr>
            <th scope="rowgroup" className="pt-4 pb-2 pr-3 font-medium">{providers[group.provider] ?? group.provider}</th>
            <td className="pt-4 pb-2 pr-3 text-right tabular-nums">{group.total.requests}</td>
            <td className="pt-4 pb-2 text-right whitespace-nowrap font-medium tabular-nums">{totalLabel(group.total)}</td>
          </tr>
          {group.activities.map(c => <tr key={c.model}>
            <th scope="row" className="py-2 pl-3 pr-3 font-normal text-muted-foreground">
              <div>{activityLabel(c.model)}</div>
              {activityLabel(c.model) !== c.model && c.model !== "realtime input transcription" && <div className="break-all text-xs">{c.model}</div>}
              {c.total.unavailable > 0 && <div className="mt-1 max-w-[38ch] text-xs leading-relaxed">{c.model === "realtime input transcription" ? "A separate transcription cost is not reported. Excluded from the subtotal." : `${c.total.unavailable} request${c.total.unavailable === 1 ? "" : "s"} with unknown cost, excluded from the subtotal.`}</div>}
              {c.total.pending > 0 && <div className="mt-1 text-xs">{c.total.pending} pending</div>}
            </th>
            <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{c.total.requests}</td>
            <td className="py-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">{c.model === "realtime input transcription" && c.total.unavailable === c.total.requests ? "Cost not reported" : totalLabel(c.total)}</td>
          </tr>)}
          <tr aria-hidden="true"><td colSpan={3} className="h-2" /></tr>
        </tbody>)}
      </table></div>}
    {data.categories.length > 0 && <><h3 className="mt-3 text-sm font-semibold">What you used · all tracked usage</h3><dl className="space-y-2">{data.categories.map(c => <div key={c.category} className="flex justify-between gap-3 text-sm"><dt className="text-muted-foreground">{categories[c.category]}</dt><dd className="tabular-nums">{totalLabel(c.total)}</dd></div>)}</dl></>}

    <div className="mt-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Request history</h3><Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button></div>
    <p className="text-xs text-muted-foreground">Each model step and service request is recorded separately. No prompts, replies, screenshots, audio, or API keys are saved here.</p>
    {historyError ? <p role="alert" className="text-sm text-destructive">History could not be loaded. Use Refresh to retry.</p> : !history ? <p className="text-sm text-muted-foreground">Loading requests…</p> : history.total === 0 ? <p className="py-4 text-sm text-muted-foreground">No usage yet. Start a conversation to see its requests and costs here.</p> : <div className="divide-y divide-border">{history.records.map(row => <details key={row.id} className="py-3">
      <summary className="cursor-pointer text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><span className="ml-1">{categories[row.category]}</span><span className="float-right pl-3 tabular-nums">{chargeLabel(row)}</span><span className="mt-1 block pl-4 text-xs text-muted-foreground">{new Date(row.startedAt).toLocaleString()} · {providers[row.provider] ?? row.provider}{row.status === "interrupted" ? " · Interrupted / unconfirmed" : ""}</span></summary>
      <div className="mt-3 space-y-2 pl-4 text-xs text-muted-foreground"><p className="break-all">{row.model}</p><p className="leading-relaxed">{row.basis}</p>{row.usd !== null && <p>{row.confidence === "reported" ? "Provider-reported" : row.confidence === "local" ? "No API charge" : "Estimated"}: ${row.usd.toFixed(6)}</p>}
        <dl className="space-y-1">{Object.entries(row.units).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt>{units[key] ?? key}</dt><dd className="tabular-nums">{value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</dd></div>)}</dl>
        {row.pricedAt && <p>Pricing snapshot: {new Date(row.pricedAt).toLocaleDateString()}</p>}
        <p className="break-all">Request: {row.id}</p><p className="break-all">Group: {row.groupId}</p>
      </div>
    </details>)}</div>}
    {history && history.total > 100 && <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => { setHistory(null); setOffset(Math.max(0, offset - 100)); }}>Newer</Button><span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + 100, history.total)} of {history.total}</span><Button variant="outline" disabled={offset + 100 >= history.total} onClick={() => { setHistory(null); setOffset(offset + 100); }}>Older</Button></div>}
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Provider invoices remain the final bill. Local speech recognition and system voices do not make paid API requests. Costs inside external agents and subscription allowances are not available to Dex yet. Earlier spending is not imported.</p>
  </>;
}
