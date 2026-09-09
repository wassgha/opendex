import { useUsage, totalLabel } from "@/lib/use-usage";
export function SpendingMeter({ compact = false }: { compact?: boolean }) {
  const { data, error } = useUsage();
  const label = error ? "Spending needs attention" : data ? `Since launch ${totalLabel(data.launch)} · Today ${totalLabel(data.today)}` : "Loading spending…";
  return <button type="button" onClick={() => void window.opendex.openSettings("usage")}
    title={`${label}. Open usage and costs. + means additional usage is pending or unpriced.`}
    aria-label={`${label}. Open usage and costs`}
    style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    className={compact ? "h-6 shrink-0 w-full px-2 text-[10px] tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" : "max-w-full truncate rounded-md border border-border bg-background px-3 py-1 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"}>
    {label}
  </button>;
}
