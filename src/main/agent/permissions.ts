import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { IPC } from "../ipc/channels";
import { getConfig, updateConfig } from "../config/store";
import type { PermissionRequester } from "./skills/types";

export type PermissionDecision = "allow_once" | "always" | "deny" | "never";

const pending = new Map<string, (decision: PermissionDecision) => void>();

/** Called by the IPC handler when the renderer answers a permission prompt. */
export function resolvePermission(id: string, decision: PermissionDecision) {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(decision);
}

/**
 * Build a permission requester bound to the chat request's renderer. The
 * `sessionAllow` set is per-requester (i.e. per user command): an "Allow once"
 * approval covers the rest of that command's multi-step tool loop, so a single
 * task (e.g. a computer-use session) doesn't re-prompt on every action. A new
 * command builds a fresh requester, so the grant doesn't silently persist.
 */
export function makePermissionRequester(sender: WebContents): PermissionRequester {
  const sessionAllow = new Set<string>();
  return (skillId, label, detail) =>
    new Promise<boolean>((resolve) => {
      // Persisted standing decisions short-circuit the prompt.
      const standing = getConfig().skills.permissions[skillId];
      if (standing === "always") return resolve(true);
      if (standing === "never") return resolve(false);
      if (sessionAllow.has(skillId)) return resolve(true);

      if (sender.isDestroyed()) return resolve(false);

      const id = randomUUID();
      pending.set(id, (decision) => {
        const allowed = decision === "allow_once" || decision === "always";
        if (allowed) sessionAllow.add(skillId);
        resolve(allowed);
      });
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
