import { useRef } from "react";
import { useAmplitudeFrame, ACTIVE_STATES } from "../use-amplitude";
import type { DexStatus } from "@/lib/dex/state";

// Decorative satellite ring cluster — concentric spinning circles, tick marks,
// and an accent arc. Purely ambient HUD chrome.
export function HudRing({
  size = 120,
  className = "",
  accent = false,
  ticks = true,
}: {
  size?: number;
  className?: string;
  accent?: boolean;
  ticks?: boolean;
}) {
  const tickLines = [];
  if (ticks) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      tickLines.push(
        <line
          key={i}
          x1={50 + Math.cos(a) * 40}
          y1={50 + Math.sin(a) * 40}
          x2={50 + Math.cos(a) * 44}
          y2={50 + Math.sin(a) * 44}
          stroke="currentColor"
          strokeWidth={0.6}
          opacity={0.4}
        />,
      );
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`text-cyan-300 ${className}`}
    >
      <g className="origin-center animate-dex-spin-slow">
        <circle cx={50} cy={50} r={47} fill="none" stroke="currentColor" strokeWidth={0.5} strokeDasharray="1 3" opacity={0.4} />
      </g>
      {ticks && <g className="origin-center animate-dex-spin-slower">{tickLines}</g>}
      <g className="origin-center animate-dex-spin-rev">
        <circle cx={50} cy={50} r={34} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="20 10" opacity={0.55} />
      </g>
      <circle cx={50} cy={50} r={26} fill="none" stroke="currentColor" strokeWidth={0.6} opacity={0.3} />
      <g className="origin-center animate-dex-spin">
        <circle cx={50} cy={50} r={20} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />
      </g>
      {accent && (
        <g className="origin-center animate-dex-spin-rev">
          <circle cx={50} cy={50} r={42} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="22 200" opacity={0.7} strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

// Small gauge: a ring with a filled value arc + a center pip — evokes the
// CPU/RAM dials in the reference.
export function HudGauge({
  size = 84,
  value = 0.7,
  label,
  className = "",
}: {
  size?: number;
  value?: number;
  label?: string;
  className?: string;
}) {
  const circumference = 2 * Math.PI * 38;
  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" className="text-cyan-300">
        <circle cx={50} cy={50} r={38} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.18} />
        <g className="origin-center animate-dex-spin-slower">
          <circle cx={50} cy={50} r={45} fill="none" stroke="currentColor" strokeWidth={0.6} strokeDasharray="1 4" opacity={0.35} />
        </g>
        <circle
          cx={50}
          cy={50}
          r={38}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${value * circumference} ${circumference}`}
          transform="rotate(-90 50 50)"
          opacity={0.85}
        />
        <circle cx={50} cy={50} r={4} fill="currentColor" opacity={0.7} />
      </svg>
      {label && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-cyan-200/70">
          {label}
        </div>
      )}
    </div>
  );
}

// Amplitude-reactive waveform strip (evokes the up/download graph). Bars pulse
// on a stagger; the whole strip scales with the live voice level.
export function HudWaveform({
  status,
  getAmplitude,
  bars = 48,
  className = "",
}: {
  status: DexStatus;
  getAmplitude: () => number;
  bars?: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    if (wrapRef.current) wrapRef.current.style.transform = `scaleY(${0.35 + a * 0.9})`;
  });
  return (
    <div
      ref={wrapRef}
      className={`flex h-10 items-end gap-[3px] origin-bottom ${className}`}
      style={{ willChange: "transform" }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] flex-1 origin-bottom rounded-sm bg-cyan-300/60 animate-dex-bar"
          style={{
            height: "100%",
            animationDelay: `${(i % 12) * 90}ms`,
            animationDuration: `${1100 + (i % 5) * 160}ms`,
          }}
        />
      ))}
    </div>
  );
}
