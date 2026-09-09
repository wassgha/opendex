import { awarenessLabel, STATUS_LABELS, type DexStatus } from "@/lib/dex/state";
import { cn } from "@/lib/utils";
import { Moon, MicOff, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function AwarenessIndicator({ status, children }: { status: DexStatus; children?: ReactNode }) {
  const asleep = status === "listening_wake" || status === "idle";
  const paused = status === "muted";
  const failed = status === "error" || status === "unsupported";
  const awake = !asleep && !paused && !failed;
  return <span role="img" aria-label={asleep ? "Asleep" : paused ? "Paused" : failed ? "Voice needs attention" : "Awake"}
    title={STATUS_LABELS[status]}
    className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", awake ? "border-dex-active bg-dex-active/20 text-dex-active animate-pulse motion-reduce:animate-none" : "border-border bg-muted/30 text-muted-foreground")}>
    {asleep ? <Moon className="size-3.5" /> : paused ? <MicOff className="size-3.5" /> : failed ? <TriangleAlert className="size-3.5" /> : children ?? <span className="size-2.5 rounded-full bg-dex-active" />}
  </span>;
}

// Dot color flows from theme tokens (--dex-active / --dex-idle / --destructive);
// brightness + pulse convey activity. Error is the one off-palette accent.
const DOT: Record<DexStatus, string> = {
  idle: "bg-dex-idle",
  listening_wake: "bg-dex-idle/60",
  active_listening: "bg-dex-active animate-pulse",
  follow_up_listening: "bg-dex-active/80 animate-pulse",
  thinking: "bg-dex-active/60 animate-pulse",
  speaking: "bg-dex-active animate-pulse",
  muted: "bg-dex-idle/60",
  error: "bg-destructive",
  unsupported: "bg-dex-idle/60",
};

// Just the status dot (no label) — for tight chrome like the notch bar.
export function StatusDot({
  status,
  className,
}: {
  status: DexStatus;
  className?: string;
}) {
  return (
    <span
      title={STATUS_LABELS[status]}
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[status], className)}
    />
  );
}

export function StatusPill({
  status,
  wakeWord = "Dex",
  className,
}: {
  status: DexStatus;
  wakeWord?: string;
  className?: string;
}) {
  return (
    <div
      role="status" aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-dex-surface/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur",
        className,
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[status])} />
      <span className="whitespace-nowrap">{awarenessLabel(status, wakeWord)}</span>
    </div>
  );
}
