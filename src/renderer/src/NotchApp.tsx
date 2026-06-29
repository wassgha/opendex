import { useEffect, useState } from "react";
import { CompactBar } from "@/components/compact-bar";
import { StatusDot } from "@/components/status-bar";
import { getDexTheme } from "@/components/themes/registry";
import { getToolView } from "@skills/tool-views";
import type { DexStatus } from "@/lib/dex/state";
import type { SessionState } from "../../main/ipc/channels";

// The latest sentence (or in-progress fragment) of `text`, so the one-line notch
// shows the sentence currently being spoken from its start, advancing as TTS
// progresses — instead of freezing on the opening or scrolling a long tail.
function currentSentence(text: string): string {
  const parts = text.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  if (!parts) return text.trim();
  const last = parts[parts.length - 1].trim();
  return last || (parts.length > 1 ? parts[parts.length - 2].trim() : "");
}

// The notch bar runs in its own transparent, always-on-top window (see
// createNotchWindow). It owns no session state: it reads the live snapshot the
// main window publishes (status + latest caption), and relays user actions —
// type, mute, expand — back to the main window's session via `view:command`.
export function NotchApp() {
  const [state, setState] = useState<SessionState | null>(null);
  const [agentName, setAgentName] = useState("");
  const [themeId, setThemeId] = useState<string>();

  useEffect(() => window.opendex.onSessionState(setState), []);

  // The notch owns no config; read the assistant name (for the type-field
  // prompt) and the active theme (for its status indicator), kept live.
  useEffect(() => {
    const apply = (c: { config: { assistant: { name: string }; appearance: { theme: string } } }) => {
      setAgentName(c.config.assistant.name);
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
  // Show the text *as it's spoken*: the current sentence of `spokenCaption`
  // (which tracks TTS playback, lagging the faster token stream). It reads from
  // the start and advances sentence-by-sentence, like live captions — rather
  // than the full reply racing ahead, or the accumulated text scrolling its tail.
  // While listening, show the user's live transcription instead.
  const caption =
    status === "thinking" || status === "speaking"
      ? currentSentence(state?.spokenCaption || "")
      : status === "active_listening" || status === "follow_up_listening"
        ? state?.liveCaption || ""
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
      toolInvocations={cards}
      agentName={agentName}
      StatusIndicator={StatusIndicator}
      isMuted={state?.muted ?? false}
      onSubmitText={(text) => window.opendex.sendViewCommand({ type: "submitText", text })}
      onToggleMute={() => window.opendex.sendViewCommand({ type: "toggleMute" })}
      onNewConversation={() => window.opendex.sendViewCommand({ type: "newConversation" })}
      onExpand={() => window.opendex.sendViewCommand({ type: "expand" })}
      onOpenSettings={() => window.opendex.openSettings()}
    />
  );
}
