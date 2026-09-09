import { ThemeFeedbackContext } from "@/components/themes/shared/theme-top-bar";
import { SpendingMeter } from "./components/spending-meter";
import { MicrophoneFeedback } from "@/components/microphone-feedback";
import { ScreenAccessPanel } from "@/components/screen-access-panel";
import { TaskProgress } from "@/components/task-progress";
import { taskProgress } from "@/lib/task-progress";
import { useEffect, useMemo } from "react";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { UpdateBanner } from "@/components/update-banner";
import { getDexTheme } from "@/components/themes/registry";
import { useConfig } from "@/lib/use-config";
import { useDex, type UseDexOptions } from "@/lib/dex/use-dex";
import type { PublicConfig } from "../../main/config/schema";
import type { OpenDexConfig } from "../../main/config/schema";

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

  // Onboarding done — config edits now happen in the dedicated settings window.
  return <MainExperience data={data} />;
}

function greetingEnabled(config: OpenDexConfig): boolean {
  if (config.greeting.mode === "none") return false;
  if (config.greeting.mode === "custom") {
    return config.greeting.customPrompt.trim().length > 0;
  }
  return true;
}

function MainExperience({ data }: { data: PublicConfig }) {
  const cfg = data.config;

  const dexOptions = useMemo<UseDexOptions>(
    () => ({
      voiceMode: cfg.voice.mode,
      realtimeIdleDisconnectSec: cfg.realtime.idleDisconnectSec,
      wakeWord: cfg.assistant.wakeWord,
      wakeMode: cfg.voiceInput.wakeMode,
      sttProvider: cfg.voiceInput.sttProvider,
      whisperModel: cfg.voiceInput.whisperModel,
      greetingEnabled: greetingEnabled(cfg),
      ttsEngine: cfg.tts.engine,
      systemVoice: cfg.tts.system,
      showToolActivity: cfg.appearance.showToolActivity,
    }),
    [
      cfg.voice.mode,
      cfg.realtime.idleDisconnectSec,
      cfg.assistant.wakeWord,
      cfg.voiceInput.wakeMode,
      cfg.voiceInput.sttProvider,
      cfg.voiceInput.whisperModel,
      cfg.greeting.mode,
      cfg.greeting.customPrompt,
      cfg.tts.engine,
      cfg.tts.system,
      cfg.appearance.showToolActivity,
    ],
  );

  const dex = useDex(dexOptions);
  const ThemeComponent = getDexTheme(cfg.appearance.theme).Component;

  // Summon hotkey → re-broadcast as a window-level signal the active text input
  // picks up (TextComposer focuses itself). Decoupled so it works in any theme.
  useEffect(
    () =>
      window.opendex.onSummoned(() =>
        window.dispatchEvent(new Event("opendex:summon")),
      ),
    [],
  );

  // Session actions relayed from the notch window (which can't reach `useDex`).
  const { submitText, toggleMute, newConversation } = dex;
  useEffect(
    () =>
      window.opendex.onRemoteCommand((cmd) => {
        if (cmd.type === "submitText") submitText(cmd.text);
        else if (cmd.type === "toggleMute") toggleMute();
        else if (cmd.type === "newConversation") newConversation();
      }),
    [submitText, toggleMute, newConversation],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Reserve a real title-bar row, including space for native window buttons. */}
      <div className={`titlebar-drag flex h-9 shrink-0 items-center justify-end pr-4 ${window.opendex.platform === "darwin" ? "pl-[88px]" : "pl-4"}`}>
        <SpendingMeter />
      </div>

      <ThemeFeedbackContext.Provider value={
        <MicrophoneFeedback feedback={dex.voiceFeedback} status={dex.status} wakeWord={cfg.assistant.wakeWord} getLevel={dex.getMicrophoneLevel} />
      }>
        <ThemeComponent
          name={cfg.assistant.name}
          wakeWord={cfg.assistant.wakeWord}
          status={dex.status}
          transcript={dex.transcript}
          liveCaption={dex.liveCaption}
          spokenCaption={dex.spokenCaption}
          getAmplitude={dex.getAmplitude}
          toolInvocations={dex.toolInvocations}
          onNewConversation={dex.newConversation}
          isMuted={dex.isMuted}
          briefingActive={dex.briefingActive}
          unsupported={dex.status === "unsupported"}
          canPushToTalk={dex.canPushToTalk}
          onPushToTalk={dex.pushToTalk}
          onSubmitText={dex.submitText}
          toggleMute={dex.toggleMute}
          onOpenSettings={() => window.opendex.openSettings()}
          onMinimize={() => window.opendex.setWindowMode("notch")}
        />

      </ThemeFeedbackContext.Provider>

      {/* Global chrome. Tool-activity hints + the Stop
          control now live in the always-on-top overlay HUD window (a separate
          renderer), so they stay visible even when this window is hidden or
          behind another app — they're intentionally not rendered here. */}
      <div className="pointer-events-none fixed inset-x-4 top-32 z-30 flex max-h-[calc(100dvh-14rem)] flex-col gap-2 overflow-y-auto">
        <div className="rounded-xl bg-background/95">
          <TaskProgress progress={taskProgress(dex.status, dex.toolInvocations)} />
        </div>
        {dex.loadingModel.active && (
          <div className="flex justify-center">
            <div className="flex min-w-0 items-center gap-3 rounded-full border border-border bg-dex-surface/85 px-5 py-2 text-sm text-foreground/80 backdrop-blur">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-foreground" />
              <span className="min-w-0 truncate">{dex.loadingModel.label || "Loading voice model…"}</span>
            </div>
          </div>
        )}
        <div className="pointer-events-auto w-full max-w-[420px] self-end"><ScreenAccessPanel onlyError /></div>
      </div>
      <UpdateBanner />

      {dex.audioBlocked && (
        <button
          type="button"
          onClick={dex.unlockAudio}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm text-foreground"
          aria-label="Tap to enable audio"
        >
          <div className="font-mono text-xs uppercase tracking-[0.4em] text-muted-foreground">
            Audio paused
          </div>
          <div className="text-2xl font-light">Tap anywhere to enable audio</div>
          <div className="max-w-sm text-center text-xs text-muted-foreground">
            Audio playback needs a single interaction to start. Once enabled,
            OpenDex will speak automatically from here on.
          </div>
        </button>
      )}
    </div>
  );
}
