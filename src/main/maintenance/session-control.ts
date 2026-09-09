import { z } from "zod";
import { archiveDesktopTask, sendDesktopMessage } from "./desktop-actions";
import { bridgeFailure } from "./desktop-tasks";

export const sessionControlSchema = z.object({
  action: z.enum(["update", "revise", "scrap"]),
  taskId: z.string().uuid().optional().describe("Exact task ID established by a tool receipt or discovery and the user's selection. Omit if the target is ambiguous; never guess from recency."),
  prompt: z.string().trim().min(1).max(20000).optional().describe("The user's requested change for update/revise. Omit if they have not said what to change."),
  operationId: z.string().uuid().describe("Fresh UUID for this logical action; reuse on retries, including uncertain delivery."),
});
export type SessionControlInput = z.infer<typeof sessionControlSchema>;

/** No global 'last task': different voice conversations must not silently
 * inherit one another's target. The conversational agent resolves an exact ID.
 * All mutations retain the existing durable receipts and desktop state checks. */
export async function controlAgentSession(input: SessionControlInput, deps = {
  send: sendDesktopMessage, archive: archiveDesktopTask,
}) {
  const i = sessionControlSchema.parse(input);
  if (!i.taskId) return { state: "needs-target", action: i.action,
    notice: "No task was changed. Ask which Codex task the user means; use exact observed titles and IDs. If session could mean the Dex voice conversation, clarify that too. Do not choose the newest task automatically." };
  if (i.action !== "scrap" && !i.prompt) return { state: "needs-revision", taskId: i.taskId, action: i.action,
    notice: "No message was sent. Ask what the user wants changed in this task, then send their revision with this exact task ID." };
  try {
    if (i.action === "scrap") {
      // Deliberately return UI guidance, not a computer worker recipe. Scrap
      // archives a task; it cannot undo edits or safely stop an active writer.
      const result = await deps.archive({ taskId: i.taskId, operationId: i.operationId });
      return { ...result, action: i.action,
        guidance: "Scrap means archive, not undo files or delete history. If rejected because work is active, open this exact task in Codex, stop it there, then archive in its menu. If active-writer, archive in the owning Codex UI. Never claim cancellation or archival from a rejection; do not retry with a new operation ID." };
    }
    return { ...await deps.send({ taskId: i.taskId, prompt: i.prompt!, operationId: i.operationId }), action: i.action };
  } catch (error) { return { ...bridgeFailure(error), taskId: i.taskId, action: i.action }; }
}
