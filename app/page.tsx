"use client";

import { JarvisOrb } from "@/components/jarvis-orb";
import { StatusBar } from "@/components/status-bar";
import { Transcript } from "@/components/transcript";
import { useJarvis } from "@/lib/jarvis/use-jarvis";

export default function Home() {
  const { status, transcript, liveCaption, engage, stop, toggleMute, isMuted } =
    useJarvis();

  const isEngaged = status !== "idle" && status !== "unsupported";
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
            Voice recognition isn’t supported in this browser. Please use a recent
            version of Chrome, Edge, or Safari on desktop.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {!isEngaged ? (
              <button
                onClick={() => void engage()}
                className="rounded-full bg-cyan-400 px-8 py-3 font-medium text-slate-950 transition hover:bg-cyan-300 active:scale-95"
              >
                Engage
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleMute}
                  className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
                >
                  {isMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={stop}
                  className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm text-white/80 transition hover:bg-rose-500/20 hover:text-rose-200"
                >
                  Stand down
                </button>
              </div>
            )}
            <p className="max-w-md text-center text-xs text-white/40">
              {status === "error"
                ? "Microphone access was denied or an unexpected error occurred. Refresh and try again."
                : "Say “Jarvis” to wake the assistant. Speak naturally — it will reply aloud."}
            </p>
          </div>
        )}
      </section>

      <section className="w-full max-w-3xl flex flex-col">
        <div className="h-72 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur">
          <Transcript turns={transcript} liveCaption={liveCaption} />
        </div>
      </section>
    </main>
  );
}
