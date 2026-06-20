import { useMemo, useState } from "react";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { PermissionPrompt } from "@/components/permission-prompt";
import { ToolActivityBanner } from "@/components/tool-activity-banner";
import { getDexTheme } from "@/components/themes/registry";
import { useConfig } from "@/lib/use-config";
import { usePermission } from "@/lib/use-permission";
import { useDex, type UseDexOptions } from "@/lib/dex/use-dex";
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

  return <MainExperience data={data} setConfig={setConfig} setSecret={setSecret} />;
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
  const permission = usePermission();
  const cfg = data.config;

  const dexOptions = useMemo<UseDexOptions>(
    () => ({
      wakeWord: cfg.assistant.wakeWord,
      wakeMode: cfg.voiceInput.wakeMode,
      porcupineKeyword: cfg.voiceInput.porcupineKeyword,
      sttProvider: cfg.voiceInput.sttProvider,
      whisperModel: cfg.voiceInput.whisperModel,
      greetingEnabled: greetingEnabled(cfg),
      ttsEngine: cfg.tts.engine,
      systemVoice: cfg.tts.system,
    }),
    [
      cfg.assistant.wakeWord,
      cfg.voiceInput.wakeMode,
      cfg.voiceInput.porcupineKeyword,
      cfg.voiceInput.sttProvider,
      cfg.voiceInput.whisperModel,
      cfg.greeting.mode,
      cfg.greeting.customPrompt,
      cfg.tts.engine,
      cfg.tts.system,
    ],
  );

  const dex = useDex(dexOptions);
  const ThemeComponent = getDexTheme(cfg.appearance.theme).Component;

  return (
    <div className="relative flex flex-1 flex-col">
      <ThemeComponent
        name={cfg.assistant.name}
        wakeWord={cfg.assistant.wakeWord}
        status={dex.status}
        transcript={dex.transcript}
        liveCaption={dex.liveCaption}
        getAmplitude={dex.getAmplitude}
        isMuted={dex.isMuted}
        bargeInEnabled={dex.bargeInEnabled}
        briefingActive={dex.briefingActive}
        unsupported={dex.status === "unsupported"}
        canPushToTalk={dex.canPushToTalk}
        onPushToTalk={dex.pushToTalk}
        onSubmitText={dex.submitText}
        toggleMute={dex.toggleMute}
        toggleBargeIn={dex.toggleBargeIn}
      />

      {/* Global chrome: settings button + audio-unlock overlay sit outside the theme. */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
        className="fixed right-4 top-4 z-30 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white/70 backdrop-blur transition hover:bg-white/10 hover:text-white"
      >
        ⚙
      </button>

      {dex.loadingModel.active && (
        <div className="fixed inset-x-0 top-16 z-30 flex justify-center">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-5 py-2 text-sm text-white/80 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {dex.loadingModel.label || "Loading voice model…"}
          </div>
        </div>
      )}

      {cfg.appearance.showToolActivity && (
        <ToolActivityBanner activity={dex.toolActivity} />
      )}

      {dex.audioBlocked && (
        <button
          type="button"
          onClick={dex.unlockAudio}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 backdrop-blur-sm text-white"
          aria-label="Tap to enable audio"
        >
          <div className="font-mono text-xs uppercase tracking-[0.4em] text-white/60">
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

      {permission.current && (
        <PermissionPrompt
          request={permission.current}
          onRespond={permission.respond}
        />
      )}
    </div>
  );
}
