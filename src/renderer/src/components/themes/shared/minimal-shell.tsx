import type { ReactNode } from "react";
import { ThemeTopBar } from "./theme-top-bar";
import { TextComposer } from "./text-composer";
import type { DexThemeProps } from "../types";
import { InputTranscript } from "@/components/input-transcript";
import { inputTranscript } from "@/lib/dex/state";

// Shared chrome for the minimalist themes (dot, cursor): a solid background, a
// centred visual, and a borderless transcript that only appears when there's
// something to show — overlaid at the bottom and fading out as lines age.
export function MinimalShell({
  props,
  themeId,
  visual,
  transcript,
  mono,
  hideTranscript,
}: {
  props: DexThemeProps;
  /** Drives the per-theme token palette via [data-dex-theme]. */
  themeId: string;
  visual: ReactNode;
  transcript?: ReactNode;
  mono?: boolean;
  /** Suppress the bottom transcript overlay (e.g. the cursor theme types it inline). */
  hideTranscript?: boolean;
}) {
  const {
    name,
    status,
    unsupported,
    canPushToTalk,
    onPushToTalk,
    briefingActive,
    isMuted,
    toggleMute,
  } = props;
  const hasTranscript =
    !hideTranscript &&
    (props.transcript.length > 0 ||
      props.liveCaption.length > 0 ||
      props.toolInvocations.length > 0);

  return (
    <div
      data-dex-theme={themeId}
      className={`relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-background px-4 pb-20 pt-24 sm:px-6 text-foreground ${
        mono ? "font-mono" : ""
      }`}
    >
      <ThemeTopBar
        wakeWord={props.wakeWord}
        name={name}
        status={status}
        onOpenSettings={props.onOpenSettings}
        onMinimize={props.onMinimize}
        onNewConversation={props.onNewConversation}
        isMuted={isMuted}
        onToggleMute={unsupported || status === "error" ? undefined : toggleMute}
      />

      <section className="z-10 flex flex-col items-center gap-6">
        {canPushToTalk ? (
          <button
            type="button"
            onClick={onPushToTalk}
            className="group flex flex-col items-center gap-2"
            title="Tap to talk (or press ⌘⇧Space)"
          >
            {visual}
            <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70 transition group-hover:text-foreground/70">
              Tap to talk
            </span>
          </button>
        ) : (
          visual
        )}

        {briefingActive && (
          <div className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
            Pulling up your dashboards…
          </div>
        )}

        {unsupported && (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Web Speech recognition isn’t available here. Open Settings (top-right)
            → Voice input and pick a local or OpenAI transcription engine.
          </p>
        )}
      </section>

      {/* Borderless transcript overlay — only when there's content, fading up. */}
      {hideTranscript && (
        <div className="absolute inset-x-0 bottom-20 z-10 mx-auto w-full max-w-2xl px-6">
          <InputTranscript text={inputTranscript(props.transcript, props.liveCaption)} interim={Boolean(props.liveCaption)} />
        </div>
      )}
      {hasTranscript && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
          <div
            className="flex max-h-[42vh] w-full max-w-2xl flex-col justify-end overflow-hidden px-6 pb-4"
            style={{
              maskImage:
                "linear-gradient(to top, black 0%, black 55%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to top, black 0%, black 55%, transparent 100%)",
            }}
          >
            {transcript}
          </div>
        </div>
      )}

      {/* Concealed typing affordance — voice-first, type when you can't speak. */}
      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <TextComposer onSubmit={props.onSubmitText} />
      </div>
    </div>
  );
}
