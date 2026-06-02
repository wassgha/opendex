import { STATUS_LABELS, type DexStatus } from "@/lib/dex/state";

// Monochrome: brightness + pulse convey state. Error is the one muted accent.
const DOT: Record<DexStatus, string> = {
  idle: "bg-white/40",
  listening_wake: "bg-white/70 animate-pulse",
  active_listening: "bg-white animate-pulse",
  follow_up_listening: "bg-white/80 animate-pulse",
  thinking: "bg-white/60 animate-pulse",
  speaking: "bg-white animate-pulse",
  muted: "bg-white/25",
  error: "bg-red-400/80",
  unsupported: "bg-white/25",
};

export function StatusBar({ status }: { status: DexStatus }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white/70 backdrop-blur">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {STATUS_LABELS[status]}
    </div>
  );
}
