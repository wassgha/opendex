import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { PermissionRequestPayload } from "../../../main/ipc/channels";
import type { PermissionDecision } from "../../../main/agent/permissions";

// The sensitive-tool confirmation. It renders as a plain card that fills its own
// dedicated popup window (see createPermissionWindow), so there's no full-screen
// dim backdrop — the window itself is the modal. Esc = one-off deny;
// "Always"/"Never" persist per-skill.
export function PermissionPrompt({
  request,
  onRespond,
}: {
  request: PermissionRequestPayload;
  onRespond: (decision: PermissionDecision) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRespond("deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRespond]);

  return (
    <div className="flex h-screen w-screen flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl">
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
          Permission required
        </div>
        <div className="text-lg font-semibold leading-none tracking-tight">
          {request.label}
        </div>
      </div>

      <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground/80">
        {request.detail}
      </p>
      <p className="text-xs text-muted-foreground">
        OpenDex wants to perform this action. Allow it?
      </p>

      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button onClick={() => onRespond("allow_once")}>Allow once</Button>
        <Button variant="secondary" onClick={() => onRespond("always")}>
          Always allow
        </Button>
        <Button variant="outline" onClick={() => onRespond("deny")}>
          Deny
        </Button>
        <Button variant="destructive" onClick={() => onRespond("never")}>
          Never
        </Button>
      </div>
    </div>
  );
}
