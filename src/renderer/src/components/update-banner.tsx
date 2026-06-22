import { useEffect, useState } from "react";
import type { UpdateStatusPayload } from "../../../main/ipc/channels";

/**
 * Surfaces auto-update progress + errors as a small top-center pill (matching
 * the voice-model download banner in App.tsx). The main process already pops a
 * native "ready to install" dialog on `downloaded`; this gives visible feedback
 * for the otherwise-silent download and for failures, and a dismiss control so
 * a stale "ready"/"error" can be cleared. Rendered as global chrome.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null);

  useEffect(() => window.opendex.onUpdateStatus(setStatus), []);

  // Errors are transient — auto-dismiss so a one-off network blip doesn't stick.
  useEffect(() => {
    if (status?.state !== "error") return;
    const t = setTimeout(() => setStatus(null), 8000);
    return () => clearTimeout(t);
  }, [status]);

  if (!status) return null;

  const label = (() => {
    switch (status.state) {
      case "available":
        return `Downloading update${status.version ? ` ${status.version}` : ""}…`;
      case "downloading":
        return `Downloading update… ${status.percent ?? 0}%`;
      case "downloaded":
        return `Update${status.version ? ` ${status.version}` : ""} ready — restart to apply`;
      case "error":
        return `Update failed: ${status.message ?? "unknown error"}`;
    }
  })();

  const isError = status.state === "error";

  return (
    <div className="fixed inset-x-0 top-16 z-30 flex justify-center">
      <div
        className={`flex items-center gap-3 rounded-full border bg-dex-surface/85 px-5 py-2 text-sm backdrop-blur ${
          isError
            ? "border-red-500/40 text-red-200"
            : "border-border text-foreground/80"
        }`}
      >
        {status.state === "downloaded" ? (
          <span className="h-2 w-2 rounded-full bg-foreground" />
        ) : !isError ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
        ) : null}
        <span>{label}</span>
        <button
          type="button"
          onClick={() => setStatus(null)}
          aria-label="Dismiss"
          className="text-foreground/40 transition-colors hover:text-foreground/80"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
