import { useCallback, useEffect, useState } from "react";
import type { UsageSummary, UsageTotal } from "../../../main/usage/types";

export function money(usd: number) {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(usd);
}
export function totalLabel(total: UsageTotal) {
  if (total.requests > 0 && total.pending + total.unavailable === total.requests) return total.pending === total.requests ? "Pending" : "Cost unknown";
  return `${total.estimated ? "≈ " : ""}${money(total.usd)}${total.unavailable || total.pending ? " +" : ""}`;
}
export function useUsage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const off = window.opendex.onUsageChanged(refresh);
    const timer = setInterval(refresh, 30_000); // Keep local-day boundaries correct while idle.
    return () => { off(); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    void window.opendex.usageSummary().then(value => {
      if (active) { setData(value); setError(value.error); }
    }).catch(() => { if (active) setError("Spending data is unavailable. Retry to reconnect."); });
    return () => { active = false; };
  }, [revision]);
  return { data, error, refresh };
}
