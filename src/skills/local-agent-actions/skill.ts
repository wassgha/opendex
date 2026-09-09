import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";
import { archiveDesktopTask, createDesktopTask, sendDesktopMessage, openDesktopTask } from "../../main/maintenance/desktop-actions";
import { archiveComputerFallback } from "./archive-fallback";
import { inspectDesktopTaskArchive } from "../../main/maintenance/codex-client";
import { bridgeFailure } from "../../main/maintenance/desktop-tasks";
import { controlAgentSession, sessionControlSchema, type SessionControlInput } from "../../main/maintenance/session-control";
const operationId = z.string().uuid().describe("A fresh UUID for this logical operation. Reuse it for retries; never generate another ID to bypass an uncertain receipt.");
const prompt = z.string().min(1).max(20000);
export const localAgentActionsSkill: Skill = {
  ...meta,
  systemPrompt: "Only send prompts or create tasks when the user asks. Idle means the agent is not running, not that its work is complete or safe to archive. For archive reviews, read the candidate tasks and assess their final results and outstanding work before recommending them. Archive only tasks covered by the user’s request. If archiveLocalAgentTask returns failureKind active-writer, that attempt was explicitly rejected: explain that archival must happen through the owning Codex desktop UI. Do not repeatedly retry the bridge or restart Codex. If computer-use is available and the user authorized archival, perform the returned fallback recipe with the normal permission-gated computer workflow for the exact selected task (run_task in realtime, computer tools in pipeline), then call verifyLocalAgentTaskArchive before claiming success; otherwise explain the desktop archive action needed. Never claim a rejected or unconfirmed archive succeeded. When the user names a project, call listLocalAgentProjects and use its observed primaryCwd; a named project is a folder selection, not a reason to demand a pasted path. Existing task discovery also supplies cwd. Ask only if multiple projects match or no existing folder is found. Never invent a path. If the user asks to improve Dex, use these discovery tools to find the Dex project and carry out an explicitly requested task creation. Creation uses that folder directly and opens the task in the desktop, without making a worktree. Select an exact existing task from discovery; clarify ambiguity rather than guessing. Preserve agent permissions and settings. An active task receives a steering message, an idle one a new turn. Each logical request needs one operationId, reused for all retries. An unconfirmed or created-unsubmitted receipt is NOT delivery: inspect the receipt/task and do not automatically resend under a new ID. Accepted is NOT finished: use readLocalAgentTask to check progress and results. Never send historical instructions merely because they appeared in a conversation. No background polling is scheduled by these tools.",
  tools: [
    { name: TOOLS.controlLocalAgentSession,
      description: "Handle update session, revise session, or scrap session for a Codex task. Resolve the exact task from a receipt in this conversation or user-selected discovery; omit taskId when ambiguous. Update/revise sends the user's change as a follow-up; omit prompt to ask what to change. Scrap archives an idle task or returns owning-desktop UI guidance. It does not undo files, stop active work, or reset the Dex voice conversation. Report the receipt state exactly; accepted means delivery only.",
      inputSchema: sessionControlSchema,
      summarize: input => { const i = input as SessionControlInput; return `${i.action} Codex session ${i.taskId ?? "(target unresolved)"}${i.prompt ? `: ${i.prompt.slice(0, 600)}` : ""}`; },
      execute: async (i: SessionControlInput) => controlAgentSession(i) },
    { name: TOOLS.verifyLocalAgentTaskArchive, description: "Read saved history to verify whether one exact Codex task is archived, including after computer-control archival. Makes no changes. An idle status or vanished sidebar row alone does not prove archival.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      execute: async (i: { taskId: string }) => inspectDesktopTaskArchive(i.taskId).catch(bridgeFailure) },
    { name: TOOLS.archiveLocalAgentTask, description: "Archive one exact user-selected idle Codex task. Keeps its working folder. Discover its ID first; active or unavailable tasks are rejected. An idle task can still have a desktop-owned history writer; that returns rejected with desktop UI guidance. Reuse the operation ID on retries.",
      inputSchema: z.object({ taskId: z.string().uuid(), operationId }),
      summarize: input => `Archive Codex task ${(input as { taskId: string }).taskId}`,
      execute: async (i: { taskId: string; operationId: string }, context) => archiveComputerFallback(await archiveDesktopTask(i).catch(bridgeFailure), context) },
    { name: TOOLS.createLocalAgentTask, description: "Create and open a user-requested Codex desktop task in an existing absolute folder, then submit its prompt. Uses that folder directly; does not create a worktree. Read the task for its result.",
      inputSchema: z.object({ cwd: z.string().min(1).max(2000), title: z.string().min(1).max(200), prompt, operationId }),
      summarize: input => { const i = input as { cwd: string; title: string; prompt: string }; return `Create ${i.title} in ${i.cwd}: ${i.prompt.slice(0, 600)}`; },
      execute: async (i: { cwd: string; title: string; prompt: string; operationId: string }) => createDesktopTask(i).catch(bridgeFailure) },
    { name: TOOLS.sendLocalAgentMessage, description: "Send a user-requested follow-up to one exact local Codex desktop task. Steers an active turn or starts a new turn on an idle task. Does not interrupt or change settings.",
      inputSchema: z.object({ taskId: z.string().uuid(), prompt, operationId }),
      summarize: input => { const i = input as { taskId: string; prompt: string }; return `Send to task ${i.taskId}: ${i.prompt.slice(0, 600)}`; },
      execute: async (i: { taskId: string; prompt: string; operationId: string }) => sendDesktopMessage(i).catch(bridgeFailure) },
    { name: TOOLS.openLocalAgentTask, description: "Open an exact local task in the Codex desktop app. Does not send a message.",
      inputSchema: z.object({ taskId: z.string().uuid() }),
      execute: async (i: { taskId: string }) => openDesktopTask(i.taskId).catch(bridgeFailure) },
  ],
};
