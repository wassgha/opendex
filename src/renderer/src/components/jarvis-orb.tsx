import { type JarvisStatus } from "@/lib/jarvis/state";

// Monochrome voice visualization — intensity and motion convey state, not hue.
const TONES: Record<JarvisStatus, { ring: string; glow: string; pulse: string }> = {
  idle: {
    ring: "from-white/15 via-white/5 to-transparent",
    glow: "shadow-[0_0_60px_rgba(255,255,255,0.10)]",
    pulse: "",
  },
  listening_wake: {
    ring: "from-white/30 via-white/10 to-transparent",
    glow: "shadow-[0_0_90px_rgba(255,255,255,0.18)]",
    pulse: "animate-jarvis-breath",
  },
  active_listening: {
    ring: "from-white/50 via-white/20 to-transparent",
    glow: "shadow-[0_0_120px_rgba(255,255,255,0.28)]",
    pulse: "animate-jarvis-pulse",
  },
  follow_up_listening: {
    ring: "from-white/40 via-white/15 to-transparent",
    glow: "shadow-[0_0_100px_rgba(255,255,255,0.22)]",
    pulse: "animate-jarvis-breath",
  },
  thinking: {
    ring: "from-white/35 via-white/10 to-transparent",
    glow: "shadow-[0_0_100px_rgba(255,255,255,0.20)]",
    pulse: "animate-jarvis-spin",
  },
  speaking: {
    ring: "from-white/60 via-white/25 to-transparent",
    glow: "shadow-[0_0_140px_rgba(255,255,255,0.32)]",
    pulse: "animate-jarvis-pulse",
  },
  muted: {
    ring: "from-white/10 via-white/5 to-transparent",
    glow: "shadow-[0_0_40px_rgba(255,255,255,0.06)]",
    pulse: "",
  },
  error: {
    ring: "from-white/20 via-white/5 to-transparent",
    glow: "shadow-[0_0_80px_rgba(255,255,255,0.10)]",
    pulse: "",
  },
  unsupported: {
    ring: "from-white/10 via-white/5 to-transparent",
    glow: "shadow-[0_0_40px_rgba(255,255,255,0.06)]",
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
        className={`relative flex h-56 w-56 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-neutral-900 to-black ${tone.glow} ${tone.pulse}`}
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
