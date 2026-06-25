import { useEffect, useState } from "react";
import type { PermissionRequestPayload } from "../../../main/ipc/channels";
import type { PermissionDecision } from "../../../main/agent/permissions";

export interface UsePermissionResult {
  current: PermissionRequestPayload | null;
  respond: (decision: PermissionDecision) => void;
}

/** Subscribes to permission prompts and exposes the current one + a responder.
 *  Requests are queued so concurrent tool calls are handled one at a time. */
export function usePermission(): UsePermissionResult {
  const [queue, setQueue] = useState<PermissionRequestPayload[]>([]);

  useEffect(() => {
    return window.opendex.onPermissionRequest((req) => {
      setQueue((q) => [...q, req]);
    });
  }, []);

  // A prompt can settle without the user answering (timeout, or the requesting
  // window died) — drop it from the queue so the popup doesn't show a stale one.
  useEffect(() => {
    return window.opendex.onPermissionDismiss((id) => {
      setQueue((q) => q.filter((r) => r.id !== id));
    });
  }, []);

  const current = queue[0] ?? null;

  const respond = (decision: PermissionDecision) => {
    if (!current) return;
    window.opendex.respondPermission(current.id, current.skillId, decision);
    setQueue((q) => q.slice(1));
  };

  return { current, respond };
}
