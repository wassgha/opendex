import { useEffect, useRef } from "react";
import { WavesHorizontal } from "lucide-react";
import { ThemeTopBar } from "./theme-top-bar";
import { TextComposer } from "./text-composer";
import { useAmplitudeFrame, ACTIVE_STATES } from "./use-amplitude";
import { STATUS_LABELS } from "@/lib/dex/state";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DexThemeProps } from "./types";

// A warm, editorial theme: the conversation reads like a page — the latest reply
// set as large hero type over a warm dark ground, recent turns collected in a
// light card below, and an accent dot that breathes with your voice. Everything
// is driven by the editorial token palette in globals.css, so it reskins cleanly.

// Long agentic turns stream one ever-growing assistant message (often with the
// inter-sentence spaces dropped, e.g. "sir.It appears…"). Rendering the whole
// blob as hero type floods the screen, so we surface only the freshest sentence
// or two — large display type stays a headline, not a wall. We also re-insert the
// missing spaces so the line reads cleanly.
function heroDisplay(text: string, maxChars = 200): string {
  const clean = text.replace(/([.!?])(?=[A-Z"'(])/g, "$1 ").trim();
  const parts = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return clean;
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]} ${out}`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}

// Amplitude-reactive accent dot; doubles as the tap-to-talk target in manual mode.
function PulseDot({ status, getAmplitude }: Pick<DexThemeProps, "status" | "getAmplitude">) {
  const ref = useRef<HTMLSpanElement>(null);
  useAmplitudeFrame(getAmplitude, ACTIVE_STATES.has(status), (a) => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = `scale(${1 + a * 0.9})`;
    el.style.boxShadow = `0 0 ${6 + a * 26}px color-mix(in srgb, var(--dex-glow) ${40 + a * 45}%, transparent)`;
  });
  const dim = ["idle", "muted", "unsupported", "error"].includes(status);
  return (
    <span
      ref={ref}
      className={cn(
        "block h-2.5 w-2.5 rounded-full bg-dex-active transition-opacity duration-300",
        dim ? "opacity-40" : "",
        status === "idle" ? "animate-dex-breath" : "",
      )}
      style={{ willChange: "transform, box-shadow" }}
    />
  );
}

export function EditorialTheme(props: DexThemeProps) {
  const {
    name,
    wakeWord,
    status,
    transcript,
    liveCaption,
    getAmplitude,
    canPushToTalk,
    onPushToTalk,
    onSubmitText,
    unsupported,
  } = props;

  const isInterim = liveCaption.length > 0;
  const lastAssistant = [...transcript].reverse().find((t) => t.role === "assistant");
  const hero =
    isInterim
      ? liveCaption
      : lastAssistant
        ? heroDisplay(lastAssistant.content)
        : `Good to see you${name ? `, this is ${name}` : ""}. Say “${wakeWord}” or type below to begin.`;

  // The latest reply already lives in the hero above; the Recent card is the
  // history *behind* it, so drop that turn here to avoid showing it twice.
  const recent = transcript.filter((t) => t.id !== lastAssistant?.id).slice(-4);

  // Keep the Recent card pinned to its newest row; otherwise growing content can
  // leave it scrolled to the oldest turn at the top.
  const recentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recentRef.current) recentRef.current.scrollTop = recentRef.current.scrollHeight;
  }, [recent.length, lastAssistant?.content]);

  const mark = (
    <span className="flex items-center gap-3">
      <WavesHorizontal className="size-6 text-foreground" strokeWidth={2.4} />
      <PulseDot status={status} getAmplitude={getAmplitude} />
    </span>
  );

  return (
    <div
      data-dex-theme="editorial"
      className="relative flex flex-1 flex-col overflow-hidden bg-background px-6 text-foreground sm:px-10"
    >
      <ThemeTopBar
        name={name}
        status={status}
        onOpenSettings={props.onOpenSettings}
        showBrand={false}
        showStatus={false}
      />

      {/* Brand mark — top-left, with the live accent dot (tap-to-talk in manual mode). */}
      <div className="traffic-light-pad pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center px-6 py-4 sm:px-10 sm:py-5">
        {canPushToTalk ? (
          <button
            type="button"
            onClick={onPushToTalk}
            title="Tap to talk (or press ⌘⇧Space)"
            className="pointer-events-auto rounded-full p-1 transition hover:opacity-80"
          >
            {mark}
          </button>
        ) : (
          mark
        )}
      </div>

      {/* Hero: the latest reply (or live caption) set large. */}
      <section className="z-0 flex flex-1 flex-col justify-center pt-16">
        <p
          className={cn(
            "line-clamp-2 max-w-2xl text-balance text-2xl font-light leading-snug tracking-tight sm:text-4xl",
            isInterim ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {hero}
        </p>
        <div className="mt-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-primary" />
          {unsupported ? "Voice unavailable — type below" : STATUS_LABELS[status]}
        </div>
      </section>

      {/* Recent turns — a light card, like a page of activity (hidden when compact). */}
      {recent.length > 0 && (
        <Card
          ref={recentRef}
          className="z-10 mb-24 hidden max-h-[28vh] w-full max-w-2xl overflow-y-auto bg-card/95 p-4 sm:block"
        >
          <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-card-foreground/40">
            Recent
          </div>
          <div className="flex flex-col gap-2 text-sm leading-relaxed">
            {recent.map((t) => (
              <div key={t.id} className="flex gap-3">
                <span className="w-12 shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.2em] text-card-foreground/40">
                  {t.role === "user" ? "You" : name || "Dex"}
                </span>
                <span className="text-card-foreground/90">{t.content || "…"}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Composer pinned to the bottom. */}
      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <TextComposer onSubmit={onSubmitText} />
      </div>
    </div>
  );
}
