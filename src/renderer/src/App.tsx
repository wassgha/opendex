import { useMemo, useState } from "react";
import { BriefingPanel } from "@/components/briefing-panel";
import { JarvisOrb } from "@/components/jarvis-orb";
import { StatusBar } from "@/components/status-bar";
import { Transcript } from "@/components/transcript";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { useConfig } from "@/lib/use-config";
import { useJarvis, type UseJarvisOptions } from "@/lib/jarvis/use-jarvis";
import type { PublicConfig } from "../../main/config/schema";
import type { DeepPartial, OpenDexConfig, SecretName } from "../../main/config/schema";

export function App() {
  const { data, loading, setConfig, setSecret, completeOnboarding } = useConfig();

  if (loading || !data) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-white/30">
          OpenDex
        </div>
      </main>
    );
  }

  if (!data.config.onboarding.completed) {
    return (
      <OnboardingWizard
        data={data}
        setConfig={setConfig}
        setSecret={setSecret}
        onComplete={completeOnboarding}
      />
    );
  }

  return (
    <MainExperience
      data={data}
      setConfig={setConfig}
      setSecret={setSecret}
    />
  );
}

function greetingEnabled(config: OpenDexConfig): boolean {
  if (config.greeting.mode === "none") return false;
  if (config.greeting.mode === "custom") {
    return config.greeting.customPrompt.trim().length > 0;
  }
  return true;
}

function MainExperience({
  data,
  setConfig,
  setSecret,
}: {
  data: PublicConfig;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cfg = data.config;

  const jarvisOptions = useMemo<UseJarvisOptions>(
    () => ({
      wakeWord: cfg.assistant.wakeWord,
      greetingEnabled: greetingEnabled(cfg),
      ttsEngine: cfg.tts.engine,
      systemVoice: cfg.tts.system,
    }),
    [
      cfg.assistant.wakeWord,
      cfg.greeting.mode,
      cfg.greeting.customPrompt,
      cfg.tts.engine,
      cfg.tts.system,
    ],
  );

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
    briefingActive,
  } = useJarvis(jarvisOptions);

  const unsupported = status === "unsupported";

  return (
    <main className="flex flex-1 flex-col items-center justify-between px-6 py-10 sm:py-14">
      <header className="flex w-full max-w-3xl items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-white/40">
          {cfg.assistant.name || "OpenDex"}
        </div>
        <div className="flex items-center gap-3">
          <StatusBar status={status} />
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="flex flex-col items-center gap-12">
        <JarvisOrb status={status} />

        {briefingActive && <BriefingPanel active={briefingActive} />}

        {unsupported ? (
          <p className="max-w-sm text-center text-sm text-white/60">
            Voice recognition isn’t available in this environment yet. The local
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
                      ? "border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20"
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
                : `Say “${cfg.assistant.wakeWord}” to begin. After a reply, ask follow-ups freely. Interrupt is off by default — enable only with headphones.`}
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
            Audio playback needs a single interaction to start. Once enabled,
            OpenDex will speak automatically from here on.
          </div>
        </button>
      )}

      {settingsOpen && (
        <SettingsPanel
          data={data}
          setConfig={setConfig}
          setSecret={setSecret}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
