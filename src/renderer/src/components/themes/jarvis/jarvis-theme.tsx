import { useEffect, useRef } from "react";
import { JarvisReactor } from "./jarvis-reactor";
import { HudRing, HudGauge, HudWaveform } from "./hud-widgets";
import { TextComposer } from "../text-composer";
import { ThemeTopBar } from "../theme-top-bar";
import { OverlayTranscript } from "../overlay-transcript";
import type { DexThemeProps } from "../types";
import type { TranscriptTurn } from "@/lib/dex/state";

// Decorative HUD corner bracket.
function Corner({ className }: { className: string }) {
  return (
    <div
      className={`pointer-events-none absolute h-16 w-16 border-primary/30 ${className}`}
    />
  );
}

function HudLog({
  turns,
  liveCaption,
  wakeWord,
}: {
  turns: TranscriptTurn[];
  liveCaption: string;
  wakeWord: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [turns, liveCaption]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-primary/70">
        <span className="h-1 w-1 rounded-full bg-primary" />
        Transcript
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto pr-1 font-mono text-xs leading-relaxed">
        {turns.length === 0 && !liveCaption ? (
          <div className="text-primary/40">Awaiting input — say “{wakeWord}”.</div>
        ) : (
          <>
            {turns.map((t) => (
              <div key={t.id} className="mb-1.5">
                <span className={t.role === "user" ? "text-foreground/60" : "text-primary/50"}>
                  {t.role === "user" ? "USR " : "DEX "}
                </span>
                <span className={t.role === "user" ? "text-foreground" : "text-foreground/80"}>
                  {t.content || "…"}
                </span>
              </div>
            ))}
            {liveCaption && (
              <div className="text-foreground/50">
                <span className="text-foreground/40">USR </span>
                <span className="italic">{liveCaption}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SOURCES = ["Google Analytics", "Product Analytics", "Stripe"];

export function JarvisTheme(props: DexThemeProps) {
  const {
    name,
    wakeWord,
    status,
    transcript,
    liveCaption,
    getAmplitude,
    isMuted,
    briefingActive,
    unsupported,
    canPushToTalk,
    onPushToTalk,
    onSubmitText,
    toggleMute,
  } = props;

  const showControls = !unsupported && status !== "error";

  return (
    <div
      data-dex-theme="jarvis"
      className="relative flex flex-1 overflow-hidden bg-background text-foreground"
    >
      {/* faint tech grid + vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.25) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(8,145,178,0.12),transparent_60%)]" />

      {/* Ambient HUD satellites scattered around the reactor (decorative). */}
      <div className="pointer-events-none absolute inset-0 z-0 hidden sm:block">
        <HudRing size={150} className="absolute left-[20%] top-[9%] opacity-50" />
        <HudRing size={96} ticks={false} className="absolute left-[33%] top-[26%] opacity-35" />
        <HudGauge size={86} value={0.62} className="absolute left-[7%] top-[34%] opacity-55 animate-dex-spin-slow" />
        <HudGauge size={66} value={0.8} className="absolute left-[9%] top-[55%] opacity-45 animate-dex-spin-slow" />
        <HudRing size={120} className="absolute left-[26%] bottom-[12%] opacity-40" />
        <HudRing size={190} accent className="absolute right-[16%] top-[8%] opacity-45" />
        <HudGauge size={70} value={0.45} className="absolute right-[30%] top-[33%] opacity-50 animate-dex-spin-slow" />
        <HudRing size={120} ticks={false} className="absolute right-[10%] bottom-[20%] opacity-40" />
        <HudGauge size={56} value={0.66} className="absolute right-[34%] bottom-[16%] opacity-45" />
        <HudWaveform
          status={status}
          getAmplitude={getAmplitude}
          className="absolute mb-16 bottom-0 left-1/2 w-80 -translate-x-1/2 opacity-60"
        />
      </div>

      <Corner className="left-5 top-20 border-l-2 border-t-2" />
      <Corner className="right-5 top-20 border-r-2 border-t-2" />
      <Corner className="bottom-5 left-5 border-b-2 border-l-2" />
      <Corner className="bottom-5 right-5 border-b-2 border-r-2" />

      <ThemeTopBar
        name={name}
        status={status}
        onOpenSettings={props.onOpenSettings}
        onMinimize={props.onMinimize}
        showBrand={false}
        isMuted={isMuted}
        onToggleMute={showControls ? toggleMute : undefined}
      />

      {/* Left HUD column: identity (wide screens) */}
      <div className="relative z-10 hidden w-64 flex-col justify-between p-8 pt-20 lg:flex">
        <div>
          <div className="font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
            {(name || "OPENDEX").toUpperCase()}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-primary/50">
            Voice Interface
          </div>
        </div>

        {briefingActive && (
          <div className="space-y-1">
            {SOURCES.map((s) => (
              <div key={s} className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/60">
                ▸ {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: the reactor (tap-to-talk in manual wake mode) */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
        {canPushToTalk ? (
          <button
            type="button"
            onClick={onPushToTalk}
            className="group flex flex-col items-center"
            title="Tap to talk (or press ⌘⇧Space)"
          >
            <JarvisReactor status={status} getAmplitude={getAmplitude} />
            <span className="-mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-primary/50 group-hover:text-foreground">
              Tap to talk
            </span>
          </button>
        ) : (
          <JarvisReactor status={status} getAmplitude={getAmplitude} />
        )}
      </div>

      {/* Right HUD column: transcript + controls + composer (wide screens) */}
      <div className="relative z-10 hidden w-[22rem] min-w-0 flex-col gap-4 p-6 pt-20 xl:flex">
        <div className="min-h-0 flex-1 rounded-lg border border-primary/20 bg-card/40 p-4 backdrop-blur">
          <HudLog turns={transcript} liveCaption={liveCaption} wakeWord={wakeWord} />
        </div>

        {unsupported && (
          <p className="font-mono text-[11px] leading-relaxed text-primary/50">
            Web Speech unavailable in the desktop app. Settings → Voice input →
            set Transcription to OpenAI Whisper (add an OpenAI key), or use
            Push-to-talk.
          </p>
        )}

        <div className="flex min-w-0">
          <TextComposer onSubmit={onSubmitText} className="font-mono" />
        </div>
      </div>

      {/* Narrow screens: transcript overlay + bottom controls + composer. */}
      {(transcript.length > 0 || liveCaption.length > 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center xl:hidden">
          <div
            className="max-h-[36vh] w-full max-w-xl overflow-hidden px-6 pb-4 font-mono"
            style={{
              maskImage:
                "linear-gradient(to top, black 0%, black 55%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to top, black 0%, black 55%, transparent 100%)",
            }}
          >
            <OverlayTranscript turns={transcript} liveCaption={liveCaption} variant="line" />
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2 px-4 xl:hidden">
        <TextComposer onSubmit={onSubmitText} className="font-mono" />
      </div>
    </div>
  );
}
