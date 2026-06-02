import { useEffect, useRef } from "react";
import { MinimalShell } from "./minimal-shell";
import { useAmplitudeFrame } from "./use-amplitude";
import type { DexThemeProps } from "./types";
import type { TranscriptTurn } from "@/lib/dex/state";

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

function TerminalLog({
  turns,
  liveCaption,
  wakeWord,
}: {
  turns: TranscriptTurn[];
  liveCaption: string;
  wakeWord: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, liveCaption]);

  if (turns.length === 0 && !liveCaption) {
    return (
      <div className="flex h-full items-center px-1 text-sm text-white/30">
        <span className="text-white/40">{">"}</span>
        <span className="ml-2">say “{wakeWord}” to begin</span>
        <span className="ml-0.5 inline-block h-4 w-2 animate-caret-blink bg-white/40" />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-1 text-sm leading-relaxed">
      {turns.map((t) => (
        <div key={t.id} className="mb-1.5 flex gap-2">
          <span className={t.role === "user" ? "text-white/40" : "text-white/30"}>
            {t.role === "user" ? ">" : "·"}
          </span>
          <span className={t.role === "user" ? "text-white" : "text-white/70"}>
            {t.content || "…"}
          </span>
        </div>
      ))}
      {liveCaption && (
        <div className="flex gap-2 text-white/40">
          <span>{">"}</span>
          <span className="italic">{liveCaption}</span>
        </div>
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
        <TerminalLog
          turns={props.transcript}
          liveCaption={props.liveCaption}
          wakeWord={props.wakeWord}
        />
      }
    />
  );
}
