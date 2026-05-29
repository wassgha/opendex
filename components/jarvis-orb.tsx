"use client";

import { type JarvisStatus } from "@/lib/jarvis/state";

const TONES: Record<JarvisStatus, { ring: string; glow: string; pulse: string }> = {
  idle: {
    ring: "from-slate-500/30 via-slate-400/10 to-transparent",
    glow: "shadow-[0_0_60px_rgba(148,163,184,0.25)]",
    pulse: "",
  },
  listening_wake: {
    ring: "from-sky-400/50 via-cyan-300/20 to-transparent",
    glow: "shadow-[0_0_90px_rgba(56,189,248,0.45)]",
    pulse: "animate-jarvis-breath",
  },
  active_listening: {
    ring: "from-cyan-300/80 via-sky-400/30 to-transparent",
    glow: "shadow-[0_0_120px_rgba(34,211,238,0.6)]",
    pulse: "animate-jarvis-pulse",
  },
  thinking: {
    ring: "from-indigo-400/60 via-violet-400/20 to-transparent",
    glow: "shadow-[0_0_100px_rgba(129,140,248,0.55)]",
    pulse: "animate-jarvis-spin",
  },
  speaking: {
    ring: "from-amber-300/80 via-amber-400/30 to-transparent",
    glow: "shadow-[0_0_140px_rgba(251,191,36,0.6)]",
    pulse: "animate-jarvis-pulse",
  },
  muted: {
    ring: "from-zinc-500/30 via-zinc-400/10 to-transparent",
    glow: "shadow-[0_0_40px_rgba(161,161,170,0.2)]",
    pulse: "",
  },
  error: {
    ring: "from-rose-500/60 via-rose-400/20 to-transparent",
    glow: "shadow-[0_0_80px_rgba(244,63,94,0.45)]",
    pulse: "",
  },
  unsupported: {
    ring: "from-zinc-500/30 via-zinc-400/10 to-transparent",
    glow: "shadow-[0_0_40px_rgba(161,161,170,0.2)]",
    pulse: "",
  },
};

export function JarvisOrb({ status }: { status: JarvisStatus }) {
  const tone = TONES[status];
  return (
    <div className="relative flex items-center justify-center" aria-hidden="true">
      <div
        className={`absolute -inset-12 rounded-full bg-gradient-radial ${tone.ring} blur-2xl`}
      />
      <div
        className={`relative flex h-56 w-56 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-slate-900 to-black ${tone.glow} ${tone.pulse}`}
      >
        <div className="absolute inset-3 rounded-full border border-white/5" />
        <div className="absolute inset-6 rounded-full border border-white/5" />
        <div className="absolute inset-10 rounded-full border border-white/10" />
        <div className="absolute inset-16 rounded-full bg-gradient-to-br from-white/10 to-transparent" />
        <div className="relative font-mono text-xs tracking-[0.4em] text-white/70">
          J · A · R · V · I · S
        </div>
      </div>
    </div>
  );
}
