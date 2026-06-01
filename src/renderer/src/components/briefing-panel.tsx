import { useEffect, useState } from "react";
import { BRIEFING_SOURCES } from "@/lib/briefing-sources";

// Cosmetic "opening tabs" sequence shown while Jarvis delivers the morning
// briefing. Each source chip activates on a stagger to mimic dashboards being
// pulled up. Purely visual — independent of the actual speech timing.
export function BriefingPanel({ active }: { active: boolean }) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!active) {
      setRevealed(0);
      return;
    }
    const timers = BRIEFING_SOURCES.map((_, i) =>
      setTimeout(() => setRevealed((n) => Math.max(n, i + 1)), 600 + i * 1100),
    );
    return () => timers.forEach(clearTimeout);
  }, [active]);

  if (!active) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/50">
        Pulling up your dashboards
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {BRIEFING_SOURCES.map((source, i) => {
          const open = i < revealed;
          return (
            <div
              key={source.id}
              className={`flex min-w-[150px] items-center gap-2.5 rounded-xl border px-4 py-2.5 transition-all duration-500 ${
                open
                  ? "border-white/25 bg-white/[0.06] opacity-100 translate-y-0"
                  : "border-white/10 bg-white/[0.02] opacity-30 translate-y-1"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  open ? "bg-white animate-pulse" : "bg-white/20"
                }`}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-white/90">
                  {source.label}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-white/40">
                  {source.detail}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
