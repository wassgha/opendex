import { useRef } from "react";
import { MinimalShell } from "../shared/minimal-shell";
import { OverlayTranscript } from "../shared/overlay-transcript";
import { useAmplitudeFrame, ACTIVE_STATES } from "../shared/use-amplitude";
import type { DexThemeProps, DexThemeDef } from "../types";

function Dot({ status, getAmplitude }: DexThemeProps) {
  const dotRef = useRef<HTMLDivElement>(null);

  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    const el = dotRef.current;
    if (!el) return;
    el.style.transform = `scale(${1 + a * 1.6})`;
    el.style.boxShadow = `0 0 ${12 + a * 60}px color-mix(in srgb, var(--dex-glow) ${(0.5 + a * 0.5) * 60}%, transparent)`;
    el.style.opacity = String(0.5 + a * 0.5);
  });

  const dim = ["idle", "muted", "unsupported", "error"].includes(status);

  return (
    <div className="flex h-56 w-56 items-center justify-center" aria-hidden="true">
      <div
        ref={dotRef}
        className={`h-6 w-6 rounded-full bg-dex-glow transition-opacity duration-300 ${
          dim ? "opacity-25" : ""
        } ${status === "idle" ? "animate-dex-breath" : ""}`}
        style={{ willChange: "transform, box-shadow, opacity" }}
      />
    </div>
  );
}

function DotTheme(props: DexThemeProps) {
  return (
    <MinimalShell
      props={props}
      themeId="dot"
      visual={<Dot {...props} />}
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

function DotPreview() {
  return <span className="h-3 w-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]" />;
}

const theme: DexThemeDef = {
  id: "dot",
  label: "Talking Dot",
  description: "A single dot that breathes with your voice. Minimal, monochrome.",
  order: 2,
  Component: DotTheme,
  Preview: DotPreview,
};

export default theme;
