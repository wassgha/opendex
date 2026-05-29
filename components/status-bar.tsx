"use client";

import { STATUS_LABELS, type JarvisStatus } from "@/lib/jarvis/state";

const DOT: Record<JarvisStatus, string> = {
  idle: "bg-slate-400",
  listening_wake: "bg-sky-400 animate-pulse",
  active_listening: "bg-cyan-300 animate-pulse",
  thinking: "bg-indigo-400 animate-pulse",
  speaking: "bg-amber-300 animate-pulse",
  muted: "bg-zinc-500",
  error: "bg-rose-500",
  unsupported: "bg-zinc-500",
};

export function StatusBar({ status }: { status: JarvisStatus }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white/70 backdrop-blur">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {STATUS_LABELS[status]}
    </div>
  );
}
