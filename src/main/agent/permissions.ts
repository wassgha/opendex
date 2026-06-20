import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { IPC } from "../ipc/channels";
import { getConfig, updateConfig } from "../config/store";
import type { PermissionRequester } from "./skills/types";

export type PermissionDecision = "allow_once" | "always" | "deny" | "never";

const pending = new Map<string, (allowed: boolean) => void>();

/** Called by the IPC handler when the renderer answers a permission prompt. */
export function resolvePermission(id: string, decision: PermissionDecision) {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(decision === "allow_once" || decision === "always");
}

/** Build a permission requester bound to the chat request's renderer. */
export function makePermissionRequester(sender: WebContents): PermissionRequester {
  return (skillId, label, detail) =>
    new Promise<boolean>((resolve) => {
      // Persisted standing decisions short-circuit the prompt.
      const standing = getConfig().skills.permissions[skillId];
      if (standing === "always") return resolve(true);
      if (standing === "never") return resolve(false);

      if (sender.isDestroyed()) return resolve(false);

      const id = randomUUID();
      pending.set(id, (allowed) => resolve(allowed));
      sender.send(IPC.permissionRequest, { id, skillId, label, detail });
    });
}

/** Persist a remembered decision, then resolve the pending request. */
export function recordAndResolve(
  id: string,
  skillId: string,
  decision: PermissionDecision,
) {
  if (decision === "always" || decision === "never") {
    const permissions = { ...getConfig().skills.permissions, [skillId]: decision };
    updateConfig({ skills: { permissions } });
  }
  resolvePermission(id, decision);
}
