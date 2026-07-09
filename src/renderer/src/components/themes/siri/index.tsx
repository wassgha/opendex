import { useRef } from "react";
import type { CSSProperties } from "react";
import { MinimalShell } from "../shared/minimal-shell";
import { OverlayTranscript } from "../shared/overlay-transcript";
import { useAmplitudeFrame, ACTIVE_STATES } from "../shared/use-amplitude";
import type { DexStatus } from "@/lib/dex/state";
import type { DexThemeProps, DexThemeDef } from "../types";

// A Siri-style glass orb. The aurora is NOT blurred blobs — it's SVG ribbon
// paths (a blue wave over a white-hot crease over an orange/red wave) with
// linear gradients and per-ribbon gaussian blur, clipped to the sphere, so the
// swoosh has crisp directional edges like the real thing. Colors stay anchored
// (blue left/top, red right/bottom — no hue cycling); motion is a slow per-
// ribbon undulation. Voice loudness (`--amp`, one CSS var written per frame)
// swells the band, brightens it, and scales the orb via calc() — zero React
// re-renders.

const RAINBOW =
  "conic-gradient(from 210deg, #34d8ff, #3b6bff, #b56bff, #ff375f, #ffb340, #7dffb0, #34d8ff)";

// Slow organic undulation for one ribbon; duration/delay/direction vary per
// path so the band never visibly repeats.
function ripple(dur: number, delay: number, reverse = false): CSSProperties {
  return {
    transformBox: "fill-box",
    transformOrigin: "50% 50%",
    animation: `dex-siri-wave ${dur}s ease-in-out ${delay}s infinite ${
      reverse ? "reverse" : "normal"
    }`,
  };
}

function SiriOrb({
  status,
  getAmplitude,
}: Pick<DexThemeProps, "status" | "getAmplitude">) {
  const orbRef = useRef<HTMLDivElement>(null);

  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    orbRef.current?.style.setProperty("--amp", a.toFixed(3));
  });

  // Idle stays vivid (the real orb rests in full color) — only muted/broken dim.
  const dim = ["muted", "unsupported", "error"].includes(status);

  return (
    <div
      className={`flex h-64 w-64 items-center justify-center ${
        status === "idle" ? "animate-dex-breath" : ""
      }`}
      aria-hidden="true"
    >
      <div
        ref={orbRef}
        className={`relative h-52 w-52 transition-opacity duration-500 ${
          dim ? "opacity-50" : ""
        }`}
        style={
          {
            "--amp": 0,
            transform: "scale(calc(1 + var(--amp) * 0.06))",
            willChange: "transform",
          } as CSSProperties
        }
      >
        {/* Soft halo hugging the sphere — barely there at rest, blooms with voice. */}
        <div
          className="absolute -inset-1 rounded-full"
          style={{
            background: RAINBOW,
            filter: "blur(10px)",
            opacity: "calc(0.02 + var(--amp) * 0.3)",
          }}
        />

        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
          <defs>
            <clipPath id="siri-clip">
              <circle cx="100" cy="100" r="95" />
            </clipPath>
            <radialGradient id="siri-body" cx="50%" cy="42%" r="65%">
              <stop offset="0%" stopColor="#0f0f13" />
              <stop offset="55%" stopColor="#07070a" />
              <stop offset="100%" stopColor="#000000" />
            </radialGradient>
            <radialGradient id="siri-gloss" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="siri-vignette" cx="50%" cy="50%" r="50%">
              <stop offset="72%" stopColor="#000000" stopOpacity="0" />
              <stop offset="93%" stopColor="#000000" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
            </radialGradient>
            <linearGradient id="siri-blue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#59e8ff" />
              <stop offset="45%" stopColor="#2f7bff" />
              <stop offset="80%" stopColor="#4d43ff" />
              <stop offset="100%" stopColor="#58e6c9" />
            </linearGradient>
            <linearGradient id="siri-crease" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#bfeeff" stopOpacity="0.2" />
              <stop offset="30%" stopColor="#eafaff" stopOpacity="0.65" />
              <stop offset="55%" stopColor="#ffffff" />
              <stop offset="75%" stopColor="#ffe9a8" />
              <stop offset="100%" stopColor="#ff8a4d" stopOpacity="0.9" />
            </linearGradient>
            <radialGradient id="siri-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff6d8" />
              <stop offset="45%" stopColor="#ffd27a" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ff9e4d" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="siri-orange" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffc24f" />
              <stop offset="55%" stopColor="#ff7a2f" />
              <stop offset="100%" stopColor="#ff2d55" />
            </linearGradient>
            <linearGradient id="siri-red" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff5a3c" />
              <stop offset="100%" stopColor="#d1123f" />
            </linearGradient>
            <filter id="siri-blur-xs" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
            <filter id="siri-blur-sm" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
            <filter id="siri-blur-md" x="-30%" y="-80%" width="160%" height="260%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id="siri-blur-lg" x="-50%" y="-120%" width="200%" height="340%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          <circle cx="100" cy="100" r="96" fill="url(#siri-body)" />

          <g clipPath="url(#siri-clip)">
            {/* The aurora band — swells and brightens with the voice. */}
            <g
              style={{
                transformBox: "fill-box",
                transformOrigin: "50% 50%",
                transform:
                  "scaleY(calc(0.88 + var(--amp) * 0.55)) scaleX(calc(1 + var(--amp) * 0.05))",
                filter:
                  "brightness(calc(1 + var(--amp) * 0.5)) saturate(calc(1 + var(--amp) * 0.3))",
              }}
            >
              {/* Faint blue reflection along the bottom of the glass. */}
              <ellipse
                cx="100"
                cy="168"
                rx="56"
                ry="13"
                fill="#2a6cff"
                opacity="0.05"
                filter="url(#siri-blur-lg)"
              />

              {/* Blue fold — crest sweeping up, underside curling back so a
                  dark "eye" of glass opens between it and the crease. All
                  ribbons converge to one tail at the right rim (~184,100). */}
              <path
                d="M 8 102
                   C 30 88, 50 76, 80 76
                   C 110 76, 132 92, 156 98
                   C 168 101, 176 100, 184 98
                   C 172 104, 158 106, 144 104
                   C 120 100, 112 88, 92 86
                   C 70 84, 40 96, 8 102 Z"
                fill="url(#siri-blue)"
                opacity="0.95"
                filter="url(#siri-blur-md)"
                style={ripple(11, 0)}
              />
              {/* Teal streak riding the crest. */}
              <path
                d="M 28 88
                   C 55 78, 88 76, 118 84
                   C 96 80, 60 84, 28 88 Z"
                fill="#8df5cf"
                opacity="0.55"
                filter="url(#siri-blur-sm)"
                style={ripple(9, -3, true)}
              />
              {/* Bright cyan streak on the fold's underside — bridges the blue
                  into the crease on the left so the layers fuse, not stack. */}
              <path
                d="M 14 101
                   C 40 93, 70 91, 96 95
                   C 70 98, 38 102, 14 101 Z"
                fill="#9ff1ff"
                opacity="0.7"
                filter="url(#siri-blur-xs)"
                style={ripple(9, -4)}
              />
              {/* Dark glass showing through the fold — carves the "eye". */}
              <path
                d="M 34 98
                   C 60 91, 88 89, 114 95
                   C 96 101, 62 104, 34 98 Z"
                fill="#000000"
                opacity="0.5"
                filter="url(#siri-blur-sm)"
                style={ripple(10, -1)}
              />

              {/* Orange wave hugging the crease from below, thickest centre-right. */}
              <path
                d="M 30 110
                   C 60 108, 92 110, 120 115
                   C 144 119, 164 116, 182 104
                   C 170 126, 142 133, 110 129
                   C 80 125, 50 119, 30 110 Z"
                fill="url(#siri-orange)"
                opacity="0.9"
                filter="url(#siri-blur-md)"
                style={ripple(10, -5)}
              />
              {/* Deep red trailing edge, sweeping up into the right tail. */}
              <path
                d="M 50 122
                   C 85 130, 120 134, 152 126
                   C 168 120, 178 112, 184 104
                   C 180 122, 158 138, 126 140
                   C 98 141, 70 132, 50 122 Z"
                fill="url(#siri-red)"
                opacity="0.55"
                filter="url(#siri-blur-sm)"
                style={ripple(12, -7, true)}
              />

              {/* The crease — tapered at both tips, dipping centre-left then
                  rising to the right tail. Dim cyan on the left (the gradient
                  fades it in), white-hot only past centre. */}
              <path
                d="M 10 104
                   C 45 100, 70 106, 100 110
                   C 130 114, 156 106, 184 98
                   C 158 112, 132 116, 102 113
                   C 74 110, 38 108, 10 104 Z"
                fill="url(#siri-crease)"
                filter="url(#siri-blur-xs)"
                style={ripple(8, -2)}
              />
              {/* White-hot core where the crease meets the orange, centre-right. */}
              <ellipse
                cx="130"
                cy="108"
                rx="34"
                ry="8"
                fill="url(#siri-core)"
                opacity="0.9"
                filter="url(#siri-blur-sm)"
                style={{ ...ripple(8, -2), mixBlendMode: "screen" }}
              />
              {/* Soft glint where the band compresses into the left rim. */}
              <ellipse
                cx="7"
                cy="104"
                rx="4"
                ry="9"
                fill="#ffffff"
                opacity="0.5"
                filter="url(#siri-blur-sm)"
              />
            </g>

            {/* Glass shading over the aurora: edge vignette + top-left gloss. */}
            <circle cx="100" cy="100" r="96" fill="url(#siri-vignette)" />
            <ellipse cx="72" cy="44" rx="56" ry="32" fill="url(#siri-gloss)" />
          </g>
        </svg>

        {/* Prismatic rim glints: narrow slivers only — red at the right edge,
            green lower-left, faint white top-left. The ring itself must stay
            invisible, so the stops are sparse and the mask band is ~1.5%. */}
        <div
          className="absolute inset-0 rounded-full animate-dex-spin-slower"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 86deg, rgba(255,90,80,0.7) 97deg, transparent 110deg, transparent 198deg, rgba(90,235,170,0.55) 207deg, transparent 218deg, transparent 296deg, rgba(255,255,255,0.6) 308deg, rgba(170,215,255,0.35) 318deg, transparent 330deg)",
            WebkitMaskImage:
              "radial-gradient(closest-side, transparent 96.5%, black 98%)",
            maskImage:
              "radial-gradient(closest-side, transparent 96.5%, black 98%)",
            opacity: "calc(0.5 + var(--amp) * 0.5)",
            filter: "blur(1px)",
          }}
        />
      </div>
    </div>
  );
}

function SiriTheme(props: DexThemeProps) {
  return (
    <MinimalShell
      props={props}
      themeId="siri"
      visual={<SiriOrb status={props.status} getAmplitude={props.getAmplitude} />}
      transcript={
        <OverlayTranscript
          turns={props.transcript}
          liveCaption={props.liveCaption}
          toolInvocations={props.toolInvocations}
          variant="bubble"
        />
      }
    />
  );
}

function SiriPreview() {
  return (
    <span
      className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full"
      style={{
        background:
          "radial-gradient(circle at 32% 25%, #1c1c22 0%, #0a0a0d 55%, #000 100%)",
        boxShadow: "inset 0 0 6px rgba(255,255,255,0.08)",
      }}
    >
      <span
        className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2"
        style={{
          background:
            "linear-gradient(90deg, #34d8ff, #2f7bff 30%, #ffffff 52%, #ff9e3d 72%, #ff375f)",
          filter: "blur(2px)",
          opacity: 0.95,
        }}
      />
    </span>
  );
}

// Notch status indicator: a tiny rainbow orb. Standby/idle stays a calm gray
// dot; active states cycle the gradient's hue (listening slow, thinking fast)
// and speaking adds a pulse. Pure CSS — the notch window has no amplitude and
// no theme-scoped vars, so colors are hardcoded (same as editorial's).
function siriMode(status: DexStatus): "idle" | "listen" | "think" | "speak" {
  if (status === "thinking") return "think";
  if (status === "speaking") return "speak";
  if (status === "active_listening" || status === "follow_up_listening") {
    return "listen";
  }
  return "idle";
}

function SiriStatusOrb({ status }: { status: DexStatus }) {
  const mode = siriMode(status);
  if (mode === "idle") {
    return (
      <span
        className="block size-2.5 rounded-full"
        style={{ background: "rgb(120 120 120)", opacity: 0.4 }}
        title={status}
        aria-hidden
      />
    );
  }
  const hueMs = mode === "think" ? 1200 : mode === "speak" ? 2400 : 4200;
  return (
    <span
      className="block size-2.5 rounded-full"
      style={{
        background: RAINBOW,
        boxShadow: "0 0 6px rgba(90,160,255,0.6)",
        animation: `dex-siri-hue ${hueMs}ms linear infinite${
          mode === "speak" ? ", dex-pulse 1.4s ease-in-out infinite" : ""
        }`,
      }}
      title={status}
      aria-hidden
    />
  );
}

const theme: DexThemeDef = {
  id: "siri",
  label: "Aurora Orb",
  description:
    "A dark glass orb with a drifting aurora band and prismatic rim — Siri-inspired.",
  order: 4,
  Component: SiriTheme,
  Preview: SiriPreview,
  StatusIndicator: SiriStatusOrb,
};

export default theme;
