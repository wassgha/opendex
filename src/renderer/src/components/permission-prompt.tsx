import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PermissionRequestPayload } from "../../../main/ipc/channels";
import type { PermissionDecision } from "../../../main/agent/permissions";

// Confirmation overlay shown when the agent wants to run a sensitive tool.
// Pauses the action until the user decides; "Always"/"Never" persist per-skill.
// Dismissing without a choice (Esc / click-outside) is treated as a one-off deny.
export function PermissionPrompt({
  request,
  onRespond,
}: {
  request: PermissionRequestPayload;
  onRespond: (decision: PermissionDecision) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onRespond("deny");
      }}
    >
      <DialogContent hideClose className="z-[60] max-w-md">
        <DialogHeader>
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
            Permission required
          </div>
          <DialogTitle>{request.label}</DialogTitle>
          <DialogDescription className="sr-only">
            OpenDex wants to perform a sensitive action. Choose how to respond.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground/80">
          {request.detail}
        </p>
        <p className="text-xs text-muted-foreground">
          OpenDex wants to perform this action. Allow it?
        </p>

        <div className="mt-2 grid grid-cols-2 gap-2">
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
      </DialogContent>
    </Dialog>
  );
}
