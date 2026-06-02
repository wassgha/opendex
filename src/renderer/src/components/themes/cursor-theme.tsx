import { useEffect, useRef, useState } from "react";
import { MinimalShell } from "./minimal-shell";
import type { DexThemeProps } from "./types";

/**
 * Reveals `target` character-by-character. If `target` grows (LLM streaming /
 * live STT), it keeps typing toward the new end; if it changes to a different
 * string (new turn), it restarts. Gives a consistent "typed by the cursor"
 * feel regardless of how the text actually arrives.
 */
function useTypewriter(target: string): string {
  const [shown, setShown] = useState("");
  const shownRef = useRef("");

  useEffect(() => {
    if (!target.startsWith(shownRef.current)) {
      shownRef.current = "";
      setShown("");
    }
    const id = setInterval(() => {
      if (shownRef.current.length >= target.length) {
        clearInterval(id);
        return;
      }
      const next = target.slice(0, shownRef.current.length + 2);
      shownRef.current = next;
      setShown(next);
    }, 26);
    return () => clearInterval(id);
  }, [target]);

  return shown;
}

function TypedLine({ status, transcript, liveCaption }: DexThemeProps) {
  // The line currently being "typed": the user's live speech if any, otherwise
  // the most recent turn (which becomes the assistant reply as it streams).
  const last = transcript[transcript.length - 1];
  const isInterim = liveCaption.length > 0;
  const target = (isInterim ? liveCaption : last?.content ?? "").trim();
  const shown = useTypewriter(target);

  const typing = shown.length < target.length;
  // Caret blinks when idle/waiting; stays solid while text is actively typing.
  const caretBlink = !typing;
  const tone = isInterim || last?.role === "user" ? "text-white/55" : "text-white/90";

  return (
    <div
      className="flex max-w-3xl items-end justify-center px-6 text-center"
      aria-hidden="true"
    >
      <span className={`text-3xl font-light leading-snug tracking-tight ${tone}`}>
        {shown}
        <span
          className={`ml-0.5 inline-block h-7 w-[3px] translate-y-1 rounded-[1px] bg-white align-middle ${
            caretBlink ? "animate-caret-blink" : ""
          } ${status === "muted" || status === "error" ? "opacity-30" : ""}`}
        />
      </span>
    </div>
  );
}

export function CursorTheme(props: DexThemeProps) {
  return (
    <MinimalShell props={props} mono hideTranscript visual={<TypedLine {...props} />} />
  );
}
