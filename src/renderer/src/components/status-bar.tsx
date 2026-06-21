import { STATUS_LABELS, type DexStatus } from "@/lib/dex/state";
import { cn } from "@/lib/utils";

// Dot color flows from theme tokens (--dex-active / --dex-idle / --destructive);
// brightness + pulse convey activity. Error is the one off-palette accent.
const DOT: Record<DexStatus, string> = {
  idle: "bg-dex-idle",
  listening_wake: "bg-dex-active/70 animate-pulse",
  active_listening: "bg-dex-active animate-pulse",
  follow_up_listening: "bg-dex-active/80 animate-pulse",
  thinking: "bg-dex-active/60 animate-pulse",
  speaking: "bg-dex-active animate-pulse",
  muted: "bg-dex-idle/60",
  error: "bg-destructive",
  unsupported: "bg-dex-idle/60",
};

export function StatusPill({
  status,
  className,
}: {
  status: DexStatus;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur",
        className,
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[status])} />
      <span className="truncate">{STATUS_LABELS[status]}</span>
    </div>
  );
}
