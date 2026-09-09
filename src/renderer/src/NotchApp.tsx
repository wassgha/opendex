import { ScreenIssueLink } from "@/components/screen-access-panel";
import { useScreenHealth } from "@/lib/use-screen-health";
import { taskProgress } from "@/lib/task-progress";
import { useEffect, useState } from "react";
import { CompactBar } from "@/components/compact-bar";
import { StatusDot } from "@/components/status-bar";
import { getDexTheme } from "@/components/themes/registry";
import { getToolView } from "@skills/tool-views";
import type { DexStatus } from "@/lib/dex/state";
import type { SessionState } from "../../main/ipc/channels";

// The notch bar runs in its own transparent, always-on-top window (see
// createNotchWindow). It owns no session state: it reads the live snapshot the
// main window publishes (status + latest caption), and relays user actions —
// type, mute, expand — back to the main window's session via `view:command`.
export function NotchApp() {
  const [state, setState] = useState<SessionState | null>(null);
  const health = useScreenHealth();
  const [dismissedCardIds, setDismissedCardIds] = useState<string[]>([]);
  const [wakeWord, setWakeWord] = useState("Dex");
  const [agentName, setAgentName] = useState("");
  const [themeId, setThemeId] = useState<string>();

  useEffect(() => window.opendex.onSessionState(setState), []);

  // The notch owns no config; read the assistant name (for the type-field
  // prompt) and the active theme (for its status indicator), kept live.
  useEffect(() => {
    const apply = (c: { config: { assistant: { name: string; wakeWord: string }; appearance: { theme: string } } }) => {
      setAgentName(c.config.assistant.name);
      setWakeWord(c.config.assistant.wakeWord);
      setThemeId(c.config.appearance.theme);
    };
    window.opendex.getConfig().then(apply);
    return window.opendex.onConfigChanged(apply);
  }, []);

  // The summon hotkey focuses this window; surface + focus the type field too.
  useEffect(
    () =>
      window.opendex.onSummoned(() =>
        window.dispatchEvent(new Event("opendex:summon")),
      ),
    [],
  );

  const status = (state?.status ?? "idle") as DexStatus;
  // Display text as it arrives. Playback captions can trail by the whole audio queue.
  const caption = status === "thinking" || status === "speaking"
    ? state?.reply || state?.spokenCaption || ""
    : status === "active_listening" || status === "follow_up_listening"
      ? state?.reply || state?.spokenCaption || ""
      : "";

  // Completed tool results that actually have a card (weather/clock/web-search).
  // Label-only tools (e.g. computer/open) are excluded so the notch doesn't open
  // an empty card body for them. The notch shows the latest as a compact card.
  const cards = (state?.toolInvocations ?? []).filter(
    (t) => t.status === "done" && getToolView(t.name).Card,
  );

  // The active theme may supply its own status indicator; otherwise the dot.
  const StatusIndicator = getDexTheme(themeId).StatusIndicator ?? StatusDot;

  return (
    <CompactBar
      status={status}
      caption={caption}
      inputTranscript={state?.inputTranscript || state?.liveCaption || ""}
      inputInterim={Boolean(state?.liveCaption)}
      voiceFeedback={state?.voiceFeedback}
      progress={taskProgress(status, state?.toolInvocations ?? [])}
      toolInvocations={cards.filter(card => !dismissedCardIds.includes(card.id))}
      agentName={agentName}
      wakeWord={wakeWord}
      recovery={health?.state === "error" ? <ScreenIssueLink /> : undefined}
      StatusIndicator={StatusIndicator}
      isMuted={state?.muted ?? false}
      onSubmitText={(text) => window.opendex.sendViewCommand({ type: "submitText", text })}
      onToggleMute={() => window.opendex.sendViewCommand({ type: "toggleMute" })}
      // Dismiss only the current results on this surface. Never reset the voice
      // session: the user may already be speaking their next command.
      onDismissCards={() => setDismissedCardIds(cards.map(card => card.id))}
      onExpand={() => window.opendex.sendViewCommand({ type: "expand" })}
      onOpenSettings={() => window.opendex.openSettings()}
    />
  );
}
