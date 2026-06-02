import { useRef } from "react";
import { useAmplitudeFrame, ACTIVE_STATES } from "../use-amplitude";
import type { DexStatus } from "@/lib/dex/state";

const C = 200; // svg center

// Radial tick marks around a ring.
function Ticks({ count, r1, r2, width, opacity }: { count: number; r1: number; r2: number; width: number; opacity: number }) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    lines.push(
      <line
        key={i}
        x1={C + cos * r1}
        y1={C + sin * r1}
        x2={C + cos * r2}
        y2={C + sin * r2}
        stroke="currentColor"
        strokeWidth={width}
        opacity={opacity}
      />,
    );
  }
  return <g>{lines}</g>;
}

export function JarvisReactor({
  status,
  getAmplitude,
}: {
  status: DexStatus;
  getAmplitude: () => number;
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    if (coreRef.current) {
      coreRef.current.style.transform = `scale(${1 + a * 0.4})`;
      coreRef.current.style.opacity = String(0.7 + a * 0.3);
    }
    if (wrapRef.current) {
      wrapRef.current.style.transform = `scale(${1 + a * 0.02})`;
    }
  });

  const dim = status === "muted" || status === "unsupported" || status === "error";

  return (
    <div
      ref={wrapRef}
      className={`relative h-[26rem] w-[26rem] text-cyan-300 transition-opacity duration-500 ${
        dim ? "opacity-30" : ""
      }`}
      aria-hidden="true"
      style={{ willChange: "transform" }}
    >
      {/* Ambient glow behind everything */}
      <div className="absolute inset-8 rounded-full bg-cyan-500/10 blur-3xl" />

      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        {/* Outer fine dashed ring — slow spin */}
        <g className="origin-center animate-dex-spin-slow">
          <circle cx={C} cy={C} r={192} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 7" opacity={0.35} />
        </g>
        {/* Segmented ring — reverse spin */}
        <g className="origin-center animate-dex-spin-rev">
          <circle cx={C} cy={C} r={168} fill="none" stroke="currentColor" strokeWidth={3} strokeDasharray="46 16" opacity={0.55} />
          {/* red accent arc */}
          <circle cx={C} cy={C} r={178} fill="none" stroke="#ef4444" strokeWidth={3} strokeDasharray="40 360" opacity={0.8} strokeLinecap="round" />
        </g>
        {/* Tick ring — slow spin */}
        <g className="origin-center animate-dex-spin-slower">
          <Ticks count={72} r1={138} r2={150} width={1} opacity={0.4} />
          <circle cx={C} cy={C} r={152} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.25} />
        </g>
        {/* Mid dashed ring — spin */}
        <g className="origin-center animate-dex-spin">
          <circle cx={C} cy={C} r={118} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="4 6" opacity={0.6} />
        </g>
        {/* Inner static rings */}
        <circle cx={C} cy={C} r={96} fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.35} />
        <circle cx={C} cy={C} r={80} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.2} />
      </svg>

      {/* Glowing reactor core */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          ref={coreRef}
          className="h-28 w-28 rounded-full"
          style={{
            willChange: "transform, opacity",
            background:
              "radial-gradient(circle at 50% 45%, #cffafe 0%, #22d3ee 35%, #0891b2 65%, rgba(8,145,178,0) 78%)",
            boxShadow: "0 0 60px rgba(34,211,238,0.6), inset 0 0 30px rgba(207,250,254,0.5)",
          }}
        />
      </div>
    </div>
  );
}
