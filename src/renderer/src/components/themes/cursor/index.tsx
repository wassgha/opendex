import { MinimalShell } from "../shared/minimal-shell";
import type { DexThemeProps, DexThemeDef } from "../types";

function TypedLine({ status, transcript, liveCaption }: DexThemeProps) {
  const last = transcript[transcript.length - 1];
  const isInterim = liveCaption.length > 0;
  const target = (isInterim ? liveCaption : last?.content ?? "").trim();
  const tone =
    isInterim || last?.role === "user" ? "text-foreground/55" : "text-foreground/90";

  return (
    <div className="flex min-h-[6rem] max-w-3xl items-center justify-center px-6 text-center" role="region" aria-label="Live conversation">
      <span className={`block max-h-[32vh] overflow-y-auto whitespace-pre-wrap break-words text-3xl font-light leading-snug tracking-tight ${tone}`}>
        {target}
        <span
          className={`ml-0.5 inline-block h-[0.9em] w-[3px] -translate-y-[0.05em] rounded-[1px] bg-foreground align-middle animate-caret-blink ${status === "muted" || status === "error" ? "opacity-30" : ""}`}
        />
      </span>
    </div>
  );
}

function CursorTheme(props: DexThemeProps) {
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

function CursorPreview() {
  return <span className="h-6 w-1.5 rounded-[2px] bg-white animate-caret-blink" />;
}

const theme: DexThemeDef = {
  id: "cursor",
  label: "Typing Cursor",
  description: "A blinking terminal caret and a plain-text log. Quiet and focused.",
  order: 3,
  Component: CursorTheme,
  Preview: CursorPreview,
};

export default theme;
