import { PermissionPrompt } from "@/components/permission-prompt";
import { usePermission } from "@/lib/use-permission";

// The permission prompt runs in its own dedicated, always-on-top popup window
// (see createPermissionWindow in the main process) rather than inside the main
// window. That way a sensitive-tool prompt is always visible — even when the
// main window is hidden, in notch mode, or behind the app the agent is driving —
// and answering it never pulls the main window out of its current layout.
export function PermissionApp() {
  const permission = usePermission();
  if (!permission.current) return null;
  return (
    <PermissionPrompt request={permission.current} onRespond={permission.respond} />
  );
}
