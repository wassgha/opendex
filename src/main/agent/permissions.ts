import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { IPC } from "../ipc/channels";
import { getConfig, updateConfig } from "../config/store";
import type { PermissionRequester } from "./skills/types";

export type PermissionDecision = "allow_once" | "always" | "deny" | "never";

// Auto-deny a prompt the user never answers, so a tool loop can't hang forever
// (e.g. the renderer is killed mid-prompt, or the user walks away).
const PERMISSION_TIMEOUT_MS = 120_000;

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
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const onDestroyed = () => settle("deny");
      // Settle exactly once and tear down all handlers, so the request can't
      // hang or leak its resolver in `pending` if the window dies or the user
      // never answers.
      const settle = (decision: PermissionDecision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        if (!sender.isDestroyed()) sender.off("destroyed", onDestroyed);
        const allowed = decision === "allow_once" || decision === "always";
        if (allowed) sessionAllow.add(skillId);
        resolve(allowed);
      };

      pending.set(id, settle);
      sender.once("destroyed", onDestroyed);
      timer = setTimeout(() => settle("deny"), PERMISSION_TIMEOUT_MS);
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
