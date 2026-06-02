import { useRef } from "react";
import { MinimalShell } from "./minimal-shell";
import { OverlayTranscript } from "./overlay-transcript";
import { useAmplitudeFrame, ACTIVE_STATES } from "./use-amplitude";
import type { DexThemeProps } from "./types";

function Dot({ status, getAmplitude }: DexThemeProps) {
  const dotRef = useRef<HTMLDivElement>(null);

  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    const el = dotRef.current;
    if (!el) return;
    el.style.transform = `scale(${1 + a * 1.6})`;
    el.style.boxShadow = `0 0 ${12 + a * 60}px rgba(255,255,255,${(0.5 + a * 0.5) * 0.6})`;
    el.style.opacity = String(0.5 + a * 0.5);
  });

  const dim = ["idle", "muted", "unsupported", "error"].includes(status);

  return (
    <div className="flex h-56 w-56 items-center justify-center" aria-hidden="true">
      <div
        ref={dotRef}
        className={`h-6 w-6 rounded-full bg-white transition-opacity duration-300 ${
          dim ? "opacity-25" : ""
        } ${status === "idle" ? "animate-dex-breath" : ""}`}
        style={{ willChange: "transform, box-shadow, opacity" }}
      />
    </div>
  );
}

export function DotTheme(props: DexThemeProps) {
  return (
    <MinimalShell
      props={props}
      visual={<Dot {...props} />}
      transcript={
        <OverlayTranscript
          turns={props.transcript}
          liveCaption={props.liveCaption}
          variant="bubble"
        />
      }
    />
  );
}
