import { useEffect, useRef } from "react";
import { STATUS_LABELS } from "@/lib/dex/state";
import { JarvisReactor } from "./jarvis-reactor";
import type { DexThemeProps } from "../types";
import type { TranscriptTurn } from "@/lib/dex/state";

// Decorative HUD corner bracket.
function Corner({ className }: { className: string }) {
  return (
    <div
      className={`pointer-events-none absolute h-16 w-16 border-cyan-400/30 ${className}`}
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
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-cyan-300/70">
        <span className="h-1 w-1 rounded-full bg-cyan-300" />
        Transcript
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto pr-1 font-mono text-xs leading-relaxed">
        {turns.length === 0 && !liveCaption ? (
          <div className="text-cyan-300/40">Awaiting input — say “{wakeWord}”.</div>
        ) : (
          <>
            {turns.map((t) => (
              <div key={t.id} className="mb-1.5">
                <span className={t.role === "user" ? "text-cyan-200/60" : "text-cyan-400/50"}>
                  {t.role === "user" ? "USR " : "DEX "}
                </span>
                <span className={t.role === "user" ? "text-cyan-50" : "text-cyan-100/80"}>
                  {t.content || "…"}
                </span>
              </div>
            ))}
            {liveCaption && (
              <div className="text-cyan-200/50">
                <span className="text-cyan-200/40">USR </span>
                <span className="italic">{liveCaption}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SOURCES = ["Google Analytics", "Nubio", "Stripe"];

export function JarvisTheme(props: DexThemeProps) {
  const {
    name,
    wakeWord,
    status,
    transcript,
    liveCaption,
    getAmplitude,
    isMuted,
    bargeInEnabled,
    briefingActive,
    unsupported,
    canPushToTalk,
    onPushToTalk,
    toggleMute,
    toggleBargeIn,
  } = props;

  return (
    <div className="relative flex flex-1 overflow-hidden bg-[#02060c] text-cyan-100">
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
      <Corner className="left-5 top-5 border-l-2 border-t-2" />
      <Corner className="right-5 top-5 border-r-2 border-t-2" />
      <Corner className="bottom-5 left-5 border-b-2 border-l-2" />
      <Corner className="bottom-5 right-5 border-b-2 border-r-2" />

      {/* Left HUD column: identity + status */}
      <div className="relative z-10 hidden w-64 flex-col justify-between p-8 lg:flex">
        <div>
          <div className="font-mono text-2xl font-semibold tracking-[0.2em] text-cyan-200">
            {(name || "OPENDEX").toUpperCase()}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-300/50">
            Voice Interface
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "error" ? "bg-red-400" : "bg-cyan-300"
              } ${status !== "idle" && status !== "muted" ? "animate-pulse" : ""}`}
            />
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200/80">
              {STATUS_LABELS[status]}
            </span>
          </div>
          {briefingActive && (
            <div className="space-y-1">
              {SOURCES.map((s) => (
                <div key={s} className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/60">
                  ▸ {s}
                </div>
              ))}
            </div>
          )}
        </div>
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
            <span className="-mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-300/50 group-hover:text-cyan-200">
              Tap to talk
            </span>
          </button>
        ) : (
          <JarvisReactor status={status} getAmplitude={getAmplitude} />
        )}
      </div>

      {/* Right HUD column: transcript + controls */}
      <div className="relative z-10 flex w-[22rem] flex-col gap-4 p-6">
        <div className="flex-1 rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-4 backdrop-blur">
          <HudLog turns={transcript} liveCaption={liveCaption} wakeWord={wakeWord} />
        </div>

        {unsupported ? (
          <p className="font-mono text-[11px] leading-relaxed text-cyan-300/50">
            Voice recognition unavailable in this environment. Local wake/STT
            engines arrive in a later release.
          </p>
        ) : (
          status !== "error" && (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="flex-1 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-500/20"
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={toggleBargeIn}
                aria-pressed={bargeInEnabled}
                title="Allow interrupting mid-reply. Requires headphones."
                className={`flex-1 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition ${
                  bargeInEnabled
                    ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-50"
                    : "border-cyan-400/20 bg-cyan-500/5 text-cyan-300/60 hover:bg-cyan-500/15"
                }`}
              >
                Interrupt {bargeInEnabled ? "On" : "Off"}
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
