import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DesktopConnection, DesktopBridgeError } from "./desktop-ipc";
import { withCodexMetadata, createDesktopTaskRecord, archiveDesktopTaskRecord, CodexConnectionError } from "./codex-client";
import { projectSnapshot } from "./desktop-tasks";

const uuid = z.string().uuid();
type Result = { state: string; operationId: string; taskId?: string; delivery?: string; notice?: string; failureKind?: string };
type Dependencies = {
  connect: () => Promise<DesktopConnection>;
  /** Internal validation switch, never a model-supplied argument. */
  creationValidated?: boolean;
  createRecord?: typeof createDesktopTaskRecord;
  archiveRecord?: typeof archiveDesktopTaskRecord;
  metadata: typeof withCodexMetadata;
  directory: () => Promise<string>;
  open: (taskId: string) => Promise<void>;
};
const defaults: Dependencies = {
  creationValidated: true,
  connect: () => DesktopConnection.open(), metadata: withCodexMetadata,
  directory: async () => join((await import("electron")).app.getPath("userData"), "maintenance", "operations"),
  open: async taskId => { await (await import("electron")).shell.openExternal(`codex://threads/${uuid.parse(taskId)}`); },
};

/** Atomically claim an operation before any side effect. Persist only a digest
 * and receipts, never prompts. A crash/timeout leaves an uncertain receipt and
 * deliberately cannot cause an automatic second delivery after restart. */
async function operation(operationId: string, input: unknown, deps: Dependencies, run: (save: (result: Result) => Promise<void>) => Promise<Result>): Promise<Result> {
  uuid.parse(operationId);
  const directory = await deps.directory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${operationId}.json`);
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const save = async (result: Result) => {
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify({ digest, result }), { mode: 0o600 });
    await rename(temp, path);
  };
  try {
    await writeFile(path, JSON.stringify({ digest, result: { state: "not-submitted", operationId, notice: "This operation may still be in progress. Inspect the task before submitting another request." } }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior = JSON.parse(await readFile(path, "utf8"));
    if (prior.digest !== digest) throw new DesktopBridgeError("rejected", "This operation ID was already used for a different request.");
    return prior.result;
  }
  try { const result = await run(save); await save(result); return result; }
  catch (error) {
    const failureKind = error instanceof CodexConnectionError ? error.kind : error instanceof DesktopBridgeError ? error.code : "internal";
    const prior = JSON.parse(await readFile(path, "utf8"));
    const result: Result = { ...prior.result, operationId, failureKind, notice: prior.result.state === "unconfirmed"
      ? "The operation was not confirmed and may have taken effect. Inspect the task; do not automatically retry."
      : "The operation was not submitted. Setup or desktop readiness failed. Inspect this receipt before a new request." };
    await save(result); return result;
  }
}

async function deliver(connection: DesktopConnection, taskId: string, prompt: string, operationId: string, beforeSend: () => Promise<void>) {
  const owner = await connection.owner(taskId);
  const snapshot = await connection.snapshot(taskId, owner);
  const task = projectSnapshot(snapshot);
  const input = [{ type: "text", text: prompt, text_elements: [] }];
  if (!["active", "idle"].includes(task.status)) throw new DesktopBridgeError("rejected", "The task is not ready for a message. Inspect it in Codex.");
  const active = task.status === "active";
  await beforeSend();
  await connection.request(active ? "thread-follower-steer-turn" : "thread-follower-start-turn", active ? {
    conversationId: taskId, clientUserMessageId: operationId, input, attachments: [],
    restoreMessage: { id: operationId, text: prompt, cwd: snapshot.cwd, createdAt: Date.now(), context: { prompt, addedFiles: [], fileAttachments: [], ideContext: null, imageAttachments: [], workspaceRoots: [snapshot.cwd] } },
  } : {
    conversationId: taskId,
    turnStart: { request: { threadId: taskId, input, clientUserMessageId: operationId }, context: { inheritThreadSettings: true } },
  }, owner);
  return active ? "steered-active-turn" : "started-turn";
}

export async function sendDesktopMessage(input: { taskId: string; prompt: string; operationId: string }, deps = defaults) {
  uuid.parse(input.taskId); z.string().min(1).max(20000).parse(input.prompt);
  return operation(input.operationId, { kind: "send", ...input }, deps, async save => {
    const connection = await deps.connect();
    try {
      await save({ state: "not-submitted", operationId: input.operationId, taskId: input.taskId });
      const delivery = await deliver(connection, input.taskId, input.prompt, input.operationId, () => save({ state: "unconfirmed", operationId: input.operationId, taskId: input.taskId }));
      return { state: "accepted", operationId: input.operationId, taskId: input.taskId, delivery, notice: "The owning desktop accepted the message. This does not mean the task finished. Read the task to follow its result." };
    } finally { connection.close(); }
  });
}

/** History persistence and idle desktop delivery validated on the pinned build. */
export async function createDesktopTask(input: { cwd: string; title: string; prompt: string; operationId: string }, deps = defaults) {
  if (!deps.creationValidated) return { state: "unsupported", notice: "Task creation is awaiting desktop validation. No task or message was created." };
  z.string().min(1).max(20000).parse(input.prompt);
  return operation(input.operationId, { kind: "create", ...input }, deps, async save => {
    const connection = await deps.connect();
    try {
      const record = await (deps.createRecord ?? createDesktopTaskRecord)({ cwd: input.cwd, title: input.title }, taskId => save({ state: "created-unsubmitted", operationId: input.operationId, taskId }));
      await deps.open(record.taskId);
      // Readiness attempts are observations, never delivery retries.
      let ready = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await connection.owner(record.taskId); ready = true; break; }
        catch { if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 300)); }
      }
      if (!ready) return { state: "created-unsubmitted", operationId: input.operationId, taskId: record.taskId, notice: "The task and its history were saved, but the desktop is not ready. No prompt was submitted." };
      const delivery = await deliver(connection, record.taskId, input.prompt, input.operationId, () => save({ state: "unconfirmed", operationId: input.operationId, taskId: record.taskId }));
      return { state: "accepted", operationId: input.operationId, taskId: record.taskId, delivery, notice: "The desktop accepted the new task's prompt. Read the task for its actual result." };
    } finally { connection.close(); }
  });
}

export async function desktopOperation(operationId: string, deps = defaults) {
  uuid.parse(operationId);
  const saved = JSON.parse(await readFile(join(await deps.directory(), `${operationId}.json`), "utf8"));
  return saved.result as Result;
}
export async function archiveDesktopTask(input: { taskId: string; operationId: string }, deps = defaults) {
  uuid.parse(input.taskId);
  return operation(input.operationId, { kind: "archive", ...input }, deps, async save => {
    await save({ state: "not-submitted", ...input });
    const connection = await deps.connect();
    try {
      const task = projectSnapshot(await connection.snapshot(input.taskId, await connection.owner(input.taskId)));
      if (task.status !== "idle") return { state: "rejected", ...input, notice: "Only an idle task can be archived by Dex. Wait for it to finish; no task was stopped or archived." };
      await save({ state: "unconfirmed", ...input, notice: "Archive may be in progress. Do not retry under a new operation ID." });
      try { await (deps.archiveRecord ?? archiveDesktopTaskRecord)(input.taskId); }
      catch (error) {
        if (error instanceof CodexConnectionError && error.kind === "active-writer") return {
          state: "rejected", ...input, failureKind: "active-writer",
          notice: "Codex explicitly rejected this archive: its desktop still holds the task's history writer, even though the agent is idle. This attempt made no archive change. Archive the exact task through the Codex desktop UI. Do not retry this bridge operation or stop the owning app to force it.",
        };
        throw error;
      }
      const result = { state: "archived", ...input, notice: "Codex confirmed archival. The task's working folder was retained." };
      await save(result);
      try { connection.archived(input.taskId, task.cwd); }
      catch { result.notice += " Desktop display refresh was not confirmed; reopen the task list if needed."; }
      return result;
    } finally { connection.close(); }
  });
}
export async function openDesktopTask(taskId: string, deps = defaults) {
  uuid.parse(taskId); const connection = await deps.connect(); connection.close();
  await deps.open(taskId); return { state: "opened", taskId, notice: "Requested desktop navigation; foreground visibility is unverified. No message was sent and no new work was started. This does not fulfill a request to create or initiate a repair task." };
}
