import { useLayoutEffect, useRef } from "react";
import { WavesHorizontal } from "lucide-react";
import { ThemeTopBar } from "./theme-top-bar";
import { TextComposer } from "./text-composer";
import { useAmplitudeFrame, ACTIVE_STATES } from "./use-amplitude";
import { STATUS_LABELS } from "@/lib/dex/state";
import { Card } from "@/components/ui/card";
import { ToolCardLayer } from "@/lib/tools/tool-card-layer";
import { cn } from "@/lib/utils";
import type { DexThemeProps } from "./types";

// A warm, editorial theme: the conversation reads like a page — the latest reply
// set as large hero type over a warm dark ground, recent turns collected in a
// light card below, and an accent dot that breathes with your voice. Everything
// is driven by the editorial token palette in globals.css, so it reskins cleanly.

// Long agentic turns stream one ever-growing assistant message with the
// inter-sentence spaces dropped (e.g. "sir.It appears…"). Re-insert a space after
// terminal punctuation that's immediately followed by a capital/quote so both the
// hero and the Recent card read cleanly. (The hero renders the whole message and
// lets its fixed two-line frame clip older text off the top — no ellipsis.)
function cleanText(text: string): string {
  return text.replace(/([.!?])(?=[A-Z"'(])/g, "$1 ").trim();
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
    spokenCaption,
    getAmplitude,
    canPushToTalk,
    onPushToTalk,
    onSubmitText,
    unsupported,
  } = props;

  const isInterim = liveCaption.length > 0;
  const lastAssistant = [...transcript].reverse().find((t) => t.role === "assistant");
  // While the assistant is thinking/speaking, follow the *spoken* caption (it
  // lags the model's much faster token stream) so the hero stays in sync with the
  // voice instead of racing to the end of the sentence. The prior reply stays up
  // during the thinking gap (spokenCaption isn't cleared until the first new
  // spoken chunk). Once settled, show the full last reply.
  const tracking = status === "thinking" || status === "speaking";
  const hero =
    isInterim
      ? liveCaption
      : tracking
        ? cleanText(spokenCaption || lastAssistant?.content || "")
        : lastAssistant
          ? cleanText(lastAssistant.content)
          : `Good to see you${name ? `, this is ${name}` : ""}. Say “${wakeWord}” or type below to begin.`;

  // The card is the running transcript — show every turn in order, including the
  // assistant's in-progress reply (it streams in live here). Don't drop the
  // latest assistant turn: doing so made the reply appear only after the *next*
  // turn, and left two user turns adjacent during the thinking gap.
  const recent = transcript.slice(-6);

  // Keep the Recent card pinned to its newest row. Depend on the rendered content
  // (ids + lengths), not just the count — a new turn that doesn't change the
  // capped length (slice(-4)) would otherwise leave the latest turn scrolled out
  // of view at the bottom.
  const recentRef = useRef<HTMLDivElement>(null);
  const recentKey = recent.map((t) => `${t.id}:${t.content.length}`).join("|");
  useLayoutEffect(() => {
    const el = recentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recentKey]);

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
        onMinimize={props.onMinimize}
        onNewConversation={props.onNewConversation}
        showBrand={false}
        showStatus={false}
        isMuted={props.isMuted}
        onToggleMute={unsupported || status === "error" ? undefined : props.toggleMute}
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

      {/* Hero: the latest reply (or live caption) set large. The frame is fixed
          at three lines and bottom-anchored with the overflow clipped, so as text
          streams in the newest words stay visible and older lines scroll off the
          top — no truncating ellipsis. (leading × 3 = the em height.) */}
      <section className="z-0 flex flex-1 flex-col justify-center pt-16">
        <div
          className={cn(
            "flex max-w-2xl flex-col justify-end overflow-hidden text-3xl font-light leading-[1.2] tracking-tight sm:text-4xl",
            isInterim ? "text-muted-foreground" : "text-foreground",
          )}
          style={{ height: "3.6em" }}
        >
          <p>{hero}</p>
        </div>
        <div className="mt-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-primary" />
          {unsupported ? "Voice unavailable — type below" : STATUS_LABELS[status]}
        </div>
      </section>

      {/* Running transcript — a light card spanning the available width, turns as
          divided rows with the role above the text. The assistant's in-progress
          reply streams in here too. */}
      {recent.length > 0 && (
        <Card
          ref={recentRef}
          className="z-10 mb-24 hidden max-h-[32vh] w-full flex-col divide-y divide-card-foreground/10 overflow-y-auto bg-card/95 px-6 sm:flex"
        >
          {recent.map((t) => {
            const isUser = t.role === "user";
            return (
              <div key={t.id} className="flex flex-col gap-1.5 py-3.5">
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-[0.25em]",
                    isUser ? "text-primary/80" : "text-card-foreground/40",
                  )}
                >
                  {isUser ? "You" : name || "Dex"}
                </span>
                <p className="text-sm leading-relaxed text-card-foreground/90">
                  {cleanText(t.content) || "…"}
                </p>
              </div>
            );
          })}
          {/* Tool result — the latest card, inline as the trailing thread row. */}
          <ToolCardLayer
            invocations={props.toolInvocations}
            surface="main"
            className="py-3.5"
          />
        </Card>
      )}

      {/* Composer pinned to the bottom. */}
      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <TextComposer onSubmit={onSubmitText} />
      </div>
    </div>
  );
}
