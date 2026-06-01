"use client";

import { JarvisOrb } from "@/components/jarvis-orb";
import { StatusBar } from "@/components/status-bar";
import { Transcript } from "@/components/transcript";
import { useJarvis } from "@/lib/jarvis/use-jarvis";

export default function Home() {
  const {
    status,
    transcript,
    liveCaption,
    toggleMute,
    isMuted,
    audioBlocked,
    unlockAudio,
    bargeInEnabled,
    toggleBargeIn,
  } = useJarvis();

  const unsupported = status === "unsupported";

  return (
    <main className="flex flex-1 flex-col items-center justify-between px-6 py-10 sm:py-14">
      <header className="flex w-full max-w-3xl items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-white/40">
          J · A · R · V · I · S
        </div>
        <StatusBar status={status} />
      </header>

      <section className="flex flex-col items-center gap-12">
        <JarvisOrb status={status} />

        {unsupported ? (
          <p className="max-w-sm text-center text-sm text-white/60">
            Voice recognition isn’t supported in this browser. Please use a
            recent version of Chrome, Edge, or Safari on desktop.
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
                      ? "border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20"
                      : "border border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                  title="Allow interrupting Jarvis mid-reply. Requires headphones to avoid echo loops."
                >
                  Interrupt: {bargeInEnabled ? "on" : "off"}
                </button>
              </div>
            )}
            <p className="max-w-md text-center text-xs text-white/40">
              {status === "error"
                ? "Microphone access was denied. Refresh the page to try again."
                : "Say “Jarvis” to begin. After a reply, ask follow-ups freely. Interrupt is off by default — enable only with headphones."}
            </p>
          </div>
        )}
      </section>

      <section className="w-full max-w-3xl flex flex-col">
        <div className="h-72 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur">
          <Transcript turns={transcript} liveCaption={liveCaption} />
        </div>
      </section>

      {audioBlocked && (
        <button
          type="button"
          onClick={unlockAudio}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/90 backdrop-blur-sm text-white"
          aria-label="Tap to enable audio"
        >
          <div className="font-mono text-xs uppercase tracking-[0.4em] text-cyan-300">
            Audio paused
          </div>
          <div className="text-2xl font-light">Tap anywhere to enable audio</div>
          <div className="max-w-sm text-center text-xs text-white/50">
            Your browser requires a tap before playing sound. Once enabled, Jarvis
            will speak automatically from here on.
          </div>
        </button>
      )}
    </main>
  );
}
