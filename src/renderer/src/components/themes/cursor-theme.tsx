import { useEffect, useRef, useState } from "react";
import { MinimalShell } from "./minimal-shell";
import type { DexThemeProps } from "./types";

const TICK_MS = 32; // per-character cadence
const HOLD_MS = 700; // pause at each sentence boundary so it's readable

/**
 * Reveals `target` one character at a time, pausing at sentence boundaries.
 * Keeps typing as `target` grows (streaming) and restarts if it changes to a
 * different string. The reveal is paced (not dumped), so paired with
 * `currentSentence()` the screen shows one sentence at a time.
 */
function useTypewriter(target: string): string {
  const [shown, setShown] = useState("");
  const shownRef = useRef("");
  const pauseUntil = useRef(0);

  useEffect(() => {
    if (!target.startsWith(shownRef.current)) {
      shownRef.current = "";
      pauseUntil.current = 0;
      setShown("");
    }
    const id = setInterval(() => {
      if (performance.now() < pauseUntil.current) return;
      if (shownRef.current.length >= target.length) return;
      const nextLen = shownRef.current.length + 1;
      const next = target.slice(0, nextLen);
      shownRef.current = next;
      setShown(next);
      const ch = next[next.length - 1];
      if (/[.!?]/.test(ch) && nextLen < target.length) {
        pauseUntil.current = performance.now() + HOLD_MS;
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [target]);

  return shown;
}

/** The latest sentence segment of `s` (so only one sentence shows at a time). */
function currentSentence(s: string): string {
  const parts = s.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  if (!parts) return s.trim();
  let seg = parts[parts.length - 1].trim();
  if (!seg && parts.length > 1) seg = parts[parts.length - 2].trim();
  return seg;
}

function TypedLine({ status, transcript, liveCaption }: DexThemeProps) {
  const last = transcript[transcript.length - 1];
  const isInterim = liveCaption.length > 0;
  const target = (isInterim ? liveCaption : last?.content ?? "").trim();
  const shown = useTypewriter(target);
  const line = currentSentence(shown);

  const done = shown.length >= target.length;
  const tone =
    isInterim || last?.role === "user" ? "text-foreground/55" : "text-foreground/90";

  return (
    <div className="flex min-h-[6rem] max-w-3xl items-center justify-center px-6 text-center" aria-hidden="true">
      <span className={`text-3xl font-light leading-snug tracking-tight ${tone}`}>
        {line}
        <span
          className={`ml-0.5 inline-block h-[0.9em] w-[3px] -translate-y-[0.05em] rounded-[1px] bg-foreground align-middle ${
            done ? "animate-caret-blink" : ""
          } ${status === "muted" || status === "error" ? "opacity-30" : ""}`}
        />
      </span>
    </div>
  );
}

export function CursorTheme(props: DexThemeProps) {
  return (
    <MinimalShell
      props={props}
      themeId="cursor"
      mono
      hideTranscript
      visual={<TypedLine {...props} />}
    />
  );
}
