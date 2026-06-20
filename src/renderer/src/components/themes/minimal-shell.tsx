import type { ReactNode } from "react";
import { StatusBar } from "@/components/status-bar";
import { TextComposer } from "./text-composer";
import type { DexThemeProps } from "./types";

// Shared chrome for the minimalist themes (dot, cursor): a solid background, a
// centred visual, and a borderless transcript that only appears when there's
// something to show — overlaid at the bottom and fading out as lines age.
export function MinimalShell({
  props,
  visual,
  transcript,
  mono,
  hideTranscript,
}: {
  props: DexThemeProps;
  visual: ReactNode;
  transcript?: ReactNode;
  mono?: boolean;
  /** Suppress the bottom transcript overlay (e.g. the cursor theme types it inline). */
  hideTranscript?: boolean;
}) {
  const { name, status, unsupported, canPushToTalk, onPushToTalk, briefingActive } =
    props;
  const hasTranscript =
    !hideTranscript &&
    (props.transcript.length > 0 || props.liveCaption.length > 0);

  return (
    <div
      className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#0b0b0c] px-6 ${
        mono ? "font-mono" : ""
      }`}
    >
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-7">
        <div className="text-xs uppercase tracking-[0.4em] text-white/40">
          {name || "OpenDex"}
        </div>
        <StatusBar status={status} />
      </header>

      <section className="z-10 flex flex-col items-center gap-6">
        {canPushToTalk ? (
          <button
            type="button"
            onClick={onPushToTalk}
            className="group flex flex-col items-center gap-2"
            title="Tap to talk (or press ⌘⇧Space)"
          >
            {visual}
            <span className="text-[10px] uppercase tracking-[0.3em] text-white/30 transition group-hover:text-white/60">
              Tap to talk
            </span>
          </button>
        ) : (
          visual
        )}

        {briefingActive && (
          <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">
            Pulling up your dashboards…
          </div>
        )}

        {unsupported && (
          <p className="max-w-sm text-center text-sm text-white/55">
            Web Speech recognition isn’t available here. Open Settings (top-right)
            → Voice input and pick a local or OpenAI transcription engine.
          </p>
        )}
      </section>

      {/* Borderless transcript overlay — only when there's content, fading up. */}
      {hasTranscript && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center">
          <div
            className="max-h-[42vh] w-full max-w-2xl overflow-hidden px-6 pb-4"
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
      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center">
        <TextComposer onSubmit={props.onSubmitText} tone="minimal" />
      </div>
    </div>
  );
}
