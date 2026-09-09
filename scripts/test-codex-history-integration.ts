/** Installed-CLI regression. All state belongs to a disposable CODEX_HOME;
 * no desktop connection, auth copy, model turn, or window navigation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexConnectionError, inspectDesktopTaskArchive, archiveDesktopTaskRecord, createDesktopTaskRecord, executablePath, withCodexMetadata } from "../src/main/maintenance/codex-client";

test("new task history survives process exit before desktop handoff", { timeout: 20000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "dex-history-integration-"));
  const executable = await executablePath();
  const methods: string[] = [];
  let writerProbe: Promise<void> | undefined;
  const options = { executable, launch: () => {
    // Only essential OS environment: no provider keys, developer config or auth.
    const child = spawn(executable, ["app-server"], { env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: process.env.TMPDIR }, stdio: "pipe" });
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = ((chunk: any, ...args: any[]) => {
      const message = JSON.parse(String(chunk)); methods.push(message.method);
      if (message.method === "thread/unsubscribe" && !writerProbe) {
        // History exists, but its original process still holds the writer.
        writerProbe = assert.rejects(archiveDesktopTaskRecord(message.params.threadId, options), error =>
          error instanceof CodexConnectionError && error.kind === "active-writer");
        void writerProbe.then(() => (write as any)(chunk, ...args), () => (write as any)(chunk, ...args));
        return true;
      }
      return (write as any)(chunk, ...args);
    }) as typeof child.stdin.write;
    return child;
  } };
  try {
    const ids: string[] = [];
    const record = await createDesktopTaskRecord({ cwd: home, title: "Isolated Dex history fixture" }, async id => { ids.push(id); }, options);
    await writerProbe;
    assert.deepEqual(ids, [record.taskId]);
    assert.equal(record.historyReady, true);
    const read: any = await withCodexMetadata(q => q("thread/read", { threadId: record.taskId, includeTurns: true }), options);
    assert.equal(read.thread.id, record.taskId);
    assert.equal(read.thread.turns.length, 0, "setup must not run a model turn");
    assert.equal((await inspectDesktopTaskArchive(record.taskId, options)).state, "unarchived");
    await archiveDesktopTaskRecord(record.taskId, options);
    assert.equal((await inspectDesktopTaskArchive(record.taskId, options)).state, "archived");
    const archived: any = await withCodexMetadata(q => q("thread/read", { threadId: record.taskId, includeTurns: false }), options);
    assert.equal(archived.thread.id, record.taskId);
    assert.ok(archived.thread.path.includes('/archived_sessions/'), "archive must survive process exit");
    assert.ok((await (await import('node:fs/promises')).stat(archived.thread.path)).isFile());
    const active: any = await withCodexMetadata(q => q("thread/list", { archived: false, limit: 20, useStateDbOnly: true, sourceKinds: [], modelProviders: [] }), options);
    assert.ok(!active.data.some((task: any) => task.id === record.taskId));
    assert.ok(methods.includes("thread/inject_items"));
    assert.ok(methods.every(method => ["initialize", "initialized", "thread/start", "thread/name/set", "thread/inject_items", "thread/unsubscribe", "thread/read", "thread/turns/list", "thread/archive", "thread/list"].includes(method)));
  } finally { await rm(home, { recursive: true, force: true }); }
});
