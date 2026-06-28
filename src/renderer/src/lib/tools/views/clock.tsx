import { TOOL_NAMES } from "../../../../../shared/tool-names";
import { registerToolView } from "../registry";
import type { ToolViewProps } from "../types";

// Shape returned by the clock skill (src/main/agent/skills/clock.ts).
interface ClockResult {
  timezone: string;
  formatted: string;
  iso: string;
  error?: string;
}

// A glanceable clock card: large current time + the weekday/date below. Uses
// theme tokens (clock isn't visually iconic like weather), so it reskins per
// theme. Time/date are re-derived in the requested timezone from the ISO stamp.
function ClockCard({ result, status, surface }: ToolViewProps) {
  const data = result as ClockResult | null;
  if (!data || status !== "done" || data.error) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur">
        {data?.error ?? "Checking the time…"}
      </div>
    );
  }

  const when = new Date(data.iso);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { timeZone: data.timezone, ...opts }).format(when);
  const time = fmt({ hour: "numeric", minute: "2-digit" });
  const date = fmt({ weekday: "long", month: "long", day: "numeric" });
  const zone = data.timezone.replace(/_/g, " ");

  if (surface === "notch" || surface === "overlay") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-foreground">
        <span className="text-2xl font-light tabular-nums leading-none">{time}</span>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>{date}</div>
          <div className="opacity-70">{zone}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-3xl border border-border bg-card/90 p-5 text-card-foreground shadow-sm backdrop-blur">
      <div className="text-5xl font-light leading-none tracking-tight tabular-nums">
        {time}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{date}</div>
      <div className="mt-0.5 text-xs text-muted-foreground/70">{zone}</div>
    </div>
  );
}

registerToolView({
  name: TOOL_NAMES.getCurrentTime,
  label: () => ({ icon: "🕐", label: "Check the time" }),
  Card: ClockCard,
});
