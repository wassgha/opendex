import type { ReactNode } from "react";
import { StatusBar } from "@/components/status-bar";
import type { DexThemeProps } from "./types";

// Shared chrome for the minimalist themes (dot, cursor). Black/white, calm.
// Themes supply their own centred `visual` and `transcript` slots.
export function MinimalShell({
  props,
  visual,
  transcript,
  mono,
}: {
  props: DexThemeProps;
  visual: ReactNode;
  transcript: ReactNode;
  mono?: boolean;
}) {
  const {
    name,
    wakeWord,
    status,
    isMuted,
    bargeInEnabled,
    toggleMute,
    toggleBargeIn,
    unsupported,
    canPushToTalk,
    onPushToTalk,
  } = props;

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-between px-6 py-10 sm:py-14 ${
        mono ? "font-mono" : ""
      }`}
    >
      <header className="flex w-full max-w-3xl items-center justify-between">
        <div className="text-xs uppercase tracking-[0.4em] text-white/40">
          {name || "OpenDex"}
        </div>
        <StatusBar status={status} />
      </header>

      <section className="flex flex-col items-center gap-10">
        {canPushToTalk ? (
          <button
            type="button"
            onClick={onPushToTalk}
            className="group flex flex-col items-center gap-2 rounded-full"
            title="Tap to talk (or press ⌘⇧Space)"
          >
            {visual}
            <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 group-hover:text-white/70">
              Tap to talk
            </span>
          </button>
        ) : (
          visual
        )}

        {props.briefingActive && (
          <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">
            Pulling up your dashboards…
          </div>
        )}

        {unsupported ? (
          <p className="max-w-sm text-center text-sm text-white/60">
            Voice recognition isn’t available in this environment yet. Local
            wake-word and speech-to-text engines arrive in a later release.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {status !== "error" && (
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleMute}
                  className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  {isMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={toggleBargeIn}
                  aria-pressed={bargeInEnabled}
                  className={`rounded-full px-5 py-2 text-sm transition ${
                    bargeInEnabled
                      ? "border border-white/40 bg-white/15 text-white hover:bg-white/20"
                      : "border border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                  title="Allow interrupting mid-reply. Requires headphones to avoid echo loops."
                >
                  Interrupt: {bargeInEnabled ? "on" : "off"}
                </button>
              </div>
            )}
            <p className="max-w-md text-center text-xs text-white/40">
              {status === "error"
                ? "Microphone access was denied. Restart OpenDex to try again."
                : `Say “${wakeWord}” to begin. After a reply, ask follow-ups freely.`}
            </p>
          </div>
        )}
      </section>

      <section className="flex w-full max-w-3xl flex-col">
        <div className="h-72 rounded-2xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur">
          {transcript}
        </div>
      </section>
    </div>
  );
}
