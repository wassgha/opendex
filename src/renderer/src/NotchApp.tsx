import { useEffect, useState } from "react";
import { CompactBar } from "@/components/compact-bar";
import type { DexStatus } from "@/lib/dex/state";
import type { SessionState } from "../../main/ipc/channels";

// The notch bar runs in its own transparent, always-on-top window (see
// createNotchWindow). It owns no session state: it reads the live snapshot the
// main window publishes (status + latest caption), and relays user actions —
// type, mute, expand — back to the main window's session via `view:command`.
export function NotchApp() {
  const [state, setState] = useState<SessionState | null>(null);
  const [agentName, setAgentName] = useState("");

  useEffect(() => window.opendex.onSessionState(setState), []);

  // The notch owns no config; read the assistant name (for the type-field
  // prompt) once and keep it live as settings change.
  useEffect(() => {
    window.opendex.getConfig().then((c) => setAgentName(c.config.assistant.name));
    return window.opendex.onConfigChanged((c) =>
      setAgentName(c.config.assistant.name),
    );
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
  // Mirror the main window: show the streamed reply while the assistant is
  // thinking/replying, and the user's live transcription while listening.
  const caption =
    status === "thinking" || status === "speaking"
      ? state?.reply || ""
      : status === "active_listening" || status === "follow_up_listening"
        ? state?.liveCaption || ""
        : "";

  return (
    <CompactBar
      status={status}
      caption={caption}
      agentName={agentName}
      isMuted={state?.muted ?? false}
      onSubmitText={(text) => window.opendex.sendViewCommand({ type: "submitText", text })}
      onToggleMute={() => window.opendex.sendViewCommand({ type: "toggleMute" })}
      onExpand={() => window.opendex.sendViewCommand({ type: "expand" })}
      onOpenSettings={() => window.opendex.openSettings()}
    />
  );
}
