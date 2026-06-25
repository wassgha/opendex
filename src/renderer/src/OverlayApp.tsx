import { useEffect, useState } from "react";
import { ToolActivityBanner, StopControl } from "@/components/tool-activity-banner";
import type { SessionState } from "../../main/ipc/channels";

// The always-on-top action HUD. This is a separate, transparent, click-through
// window (see createOverlayWindow in the main process) so the agent's actions
// stay visible even when the main window is hidden or behind another app — the
// normal case during computer-use. It owns no session state of its own; it just
// renders whatever snapshot the main window publishes via the session relay.
export function OverlayApp() {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => window.opendex.onSessionState(setState), []);

  const busy = state?.status === "thinking" || state?.status === "speaking";

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {busy && (
        // The container is click-through; only this wrapper around the Stop
        // button arms pointer events (via main toggling ignoreMouseEvents) so a
        // click lands while the rest of the HUD stays pass-through.
        <div
          className="pointer-events-auto"
          onMouseEnter={() => window.opendex.setOverlayInteractive(true)}
          onMouseLeave={() => window.opendex.setOverlayInteractive(false)}
        >
          <StopControl onStop={() => window.opendex.overlayInterrupt()} />
        </div>
      )}
      {state && state.activity.length > 0 && (
        <ToolActivityBanner activity={state.activity} />
      )}
    </div>
  );
}
