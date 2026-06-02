import { useRef } from "react";
import { MinimalShell } from "./minimal-shell";
import { OverlayTranscript } from "./overlay-transcript";
import { useAmplitudeFrame } from "./use-amplitude";
import type { DexThemeProps } from "./types";

function Caret({ status, getAmplitude }: DexThemeProps) {
  const caretRef = useRef<HTMLSpanElement>(null);

  useAmplitudeFrame(getAmplitude, status === "speaking", (a) => {
    const el = caretRef.current;
    if (!el) return;
    el.style.opacity = String(0.55 + a * 0.45);
    el.style.transform = `scaleY(${1 + a * 0.18})`;
  });

  const blinking =
    status === "idle" ||
    status === "listening_wake" ||
    status === "active_listening" ||
    status === "follow_up_listening" ||
    status === "muted";
  const dim = status === "muted" || status === "unsupported" || status === "error";

  return (
    <div className="flex h-56 w-56 items-center justify-center" aria-hidden="true">
      {status === "thinking" ? (
        <span className="flex gap-2 text-5xl text-white/80">
          {[0, 200, 400].map((d) => (
            <span key={d} className="animate-caret-blink" style={{ animationDelay: `${d}ms` }}>
              .
            </span>
          ))}
        </span>
      ) : (
        <span
          ref={caretRef}
          className={`inline-block h-20 w-5 rounded-[3px] bg-white ${
            blinking ? "animate-caret-blink" : ""
          } ${dim ? "opacity-25" : ""}`}
          style={{ willChange: "opacity, transform" }}
        />
      )}
    </div>
  );
}

export function CursorTheme(props: DexThemeProps) {
  return (
    <MinimalShell
      props={props}
      mono
      visual={<Caret {...props} />}
      transcript={
        <OverlayTranscript
          turns={props.transcript}
          liveCaption={props.liveCaption}
          variant="line"
        />
      }
    />
  );
}
