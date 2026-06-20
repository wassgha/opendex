import type { PermissionRequestPayload } from "../../../main/ipc/channels";
import type { PermissionDecision } from "../../../main/agent/permissions";

// Confirmation overlay shown when the agent wants to run a sensitive tool.
// Pauses the action until the user decides; "Always"/"Never" persist per-skill.
export function PermissionPrompt({
  request,
  onRespond,
}: {
  request: PermissionRequestPayload;
  onRespond: (decision: PermissionDecision) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e0e0e] p-6 shadow-2xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-white/40">
          Permission required
        </div>
        <h2 className="mt-2 text-lg font-semibold text-white">{request.label}</h2>
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80">
          {request.detail}
        </p>
        <p className="mt-3 text-xs text-white/40">
          OpenDex wants to perform this action. Allow it?
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => onRespond("allow_once")}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Allow once
          </button>
          <button
            onClick={() => onRespond("always")}
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            Always allow
          </button>
          <button
            onClick={() => onRespond("deny")}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond("never")}
            className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2 text-sm text-rose-200/80 transition hover:bg-rose-500/15"
          >
            Never
          </button>
        </div>
      </div>
    </div>
  );
}
