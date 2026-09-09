import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopConnection } from "../src/main/maintenance/desktop-ipc";
import { projectTurn, snapshotTurns } from "../src/main/maintenance/desktop-tasks";
import { sendDesktopMessage, createDesktopTask, desktopOperation } from "../src/main/maintenance/desktop-actions";
const taskId = "b96dc42d-cd8c-47ea-836a-9302a378a397";
const operationId = "6e609249-bce7-40d9-8352-b38a58f810ec";

async function fixture(run: (connection: DesktopConnection) => Promise<void>, wrongOwner = false) {
  const dir = await mkdtemp(join(tmpdir(), "dex-ipc-"));
  const path = join(dir, "ipc.sock");
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0);
    const send = (frame: unknown) => { const body = Buffer.from(JSON.stringify(frame)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(header.subarray(0, 2)); socket.write(Buffer.concat([header.subarray(2), body])); };
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const n = buffer.readUInt32LE(0); const request = JSON.parse(buffer.subarray(4, n + 4).toString()); buffer = buffer.subarray(n + 4);
        if (request.type === "request") send({ type: "response", requestId: request.requestId, resultType: "success", handledByClientId: wrongOwner && request.targetClientId ? "wrong" : "desktop", result: request.method === "initialize" ? { clientId: "dex" } : {} });
        if (request.method === "thread-stream-following-changed" && request.params.following) {
          // Wrong version/source must be ignored before the actual snapshot.
          for (const [sourceClientId, version] of [["intruder", 11], ["desktop", 10], ["desktop", 11]] as const) send({ type: "broadcast", method: "thread-stream-state-changed", version, sourceClientId, params: { hostId: "local", conversationId: taskId, change: { type: "snapshot", conversationState: { id: taskId, cwd: "/tmp", threadRuntimeStatus: { type: "idle" }, marker: sourceClientId + version } } } });
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const connection = await DesktopConnection.open(path, 500);
  try { await run(connection); } finally { connection.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
}

test("desktop framing and snapshots validate task, owner, and protocol version", async () => {
  await fixture(async connection => {
    const owner = await connection.owner(taskId);
    const snapshot = await connection.snapshot(taskId, owner);
    assert.equal(snapshot.marker, "desktop11");
  });
});
test("targeted responses from another owner cannot confirm delivery", async () => {
  await fixture(async connection => {
    await assert.rejects(connection.request("thread-follower-start-turn", {}, "desktop"), /selected task owner/);
  }, true);
});
test("history projection preserves ordering and excludes reasoning, tools, and media", () => {
  const snapshot = { turnHistory: { kind: "canonical", history: { entitiesByKey: { a: { turnId: "1", items: [] } }, islands: [{ entries: [{ value: "a" }] }] } }, turns: [{ turnId: "1", status: "completed", items: [{ type: "agentMessage", text: "done", phase: "final_answer" }, { type: "reasoning", text: "private-reasoning" }, { type: "commandExecution", text: "private-command" }] }] };
  const turns = snapshotTurns(snapshot);
  assert.equal(turns.length, 1);
  const projected = projectTurn(turns[0]);
  assert.deepEqual(projected.messages, [{ role: "assistant", text: "done", phase: "final" }]);
});

for (const active of [false, true]) test(`delivery uses ${active ? "steer" : "start"}, preserves settings, and deduplicates across restarts`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "dex-receipt-")); const calls: any[] = [];
  const fake = { owner: async () => "desktop", snapshot: async () => ({ id: taskId, cwd: "/tmp", threadRuntimeStatus: { type: active ? "active" : "idle" } }), request: async (...args: unknown[]) => { calls.push(args); return {}; }, close: () => {} } as unknown as DesktopConnection;
  const deps = { connect: async () => fake, directory: async () => dir, metadata: async () => { throw Error("metadata not allowed"); }, open: async () => { throw Error("navigation not allowed"); } };
  const input = { taskId, operationId, prompt: "test secret conversation text" };
  try {
    assert.equal((await sendDesktopMessage(input, deps)).state, "accepted");
    assert.equal((await sendDesktopMessage(input, deps)).state, "accepted");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], active ? "thread-follower-steer-turn" : "thread-follower-start-turn");
    assert.equal(calls[0][2], "desktop");
    assert.doesNotMatch(JSON.stringify(calls), /approvalPolicy|sandbox|model/);
    assert.doesNotMatch(await readFile(join(dir, `${operationId}.json`), "utf8"), /secret conversation/);
    await assert.rejects(sendDesktopMessage({ ...input, prompt: "different" }, deps), /different request/);
    assert.equal((await desktopOperation(operationId, deps)).taskId, taskId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("uncertain delivery retains target receipt and never retries a failed transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dex-receipt-")); let attempts = 0;
  const fake = { owner: async () => "desktop", snapshot: async () => ({ id: taskId, cwd: "/tmp", threadRuntimeStatus: { type: "idle" } }), request: async () => { attempts++; throw Error("timeout"); }, close: () => {} } as unknown as DesktopConnection;
  const deps = { connect: async () => fake, directory: async () => dir, metadata: async () => { throw Error(); }, open: async () => {} };
  try {
    const input = { taskId, operationId, prompt: "hello" };
    assert.equal((await sendDesktopMessage(input, deps)).taskId, taskId);
    assert.equal((await sendDesktopMessage(input, deps)).state, "unconfirmed");
    assert.equal(attempts, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("unsupported creation performs no disk, desktop, or metadata mutation", async () => {
  const unavailable = async (): Promise<never> => { throw Error("must not be called"); };
  const result = await createDesktopTask({ cwd: "/tmp", title: "test", prompt: "test", operationId }, { connect: unavailable, metadata: unavailable, directory: unavailable, open: unavailable });
  assert.equal(result.state, "unsupported");
});

test("creation verifies saved history before navigation and never submits twice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dex-create-")); const steps: string[] = [];
  const connection = { owner: async () => { steps.push("owner"); return "desktop"; }, snapshot: async () => ({ id: taskId, cwd: "/tmp", threadRuntimeStatus: { type: "idle" } }), request: async () => { steps.push("submit"); return {}; }, close: () => {} } as unknown as DesktopConnection;
  const deps = { creationValidated: true, connect: async () => connection, directory: async () => dir, metadata: async () => { throw Error(); },
    createRecord: async (_input: unknown, save: (id: string) => Promise<void>) => { steps.push("persist-history"); await save(taskId); return { taskId, historyReady: true as const }; },
    open: async () => { steps.push("open"); },
  };
  try {
    const input = { cwd: "/tmp", title: "Fixture", prompt: "hello", operationId };
    assert.equal((await createDesktopTask(input, deps)).state, "accepted");
    assert.equal((await createDesktopTask(input, deps)).state, "accepted");
    assert.deepEqual(steps, ["persist-history", "open", "owner", "owner", "submit"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("failed history persistence never opens the desktop or sends a prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dex-create-"));
  const deps = { creationValidated: true, connect: async () => ({ close() {} } as DesktopConnection), directory: async () => dir, metadata: async () => { throw Error(); },
    createRecord: async (_input: unknown, save: (id: string) => Promise<void>): Promise<never> => { await save(taskId); throw Error("history failure"); },
    open: async () => { assert.fail("must not navigate"); },
  };
  try {
    const result = await createDesktopTask({ cwd: "/tmp", title: "Fixture", prompt: "hello", operationId }, deps);
    assert.equal(result.state, "created-unsubmitted");
    assert.equal((await desktopOperation(operationId, deps)).taskId, taskId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("owner discovery failure is correctly reported as not submitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dex-send-"));
  const deps = { connect: async () => ({ owner: async () => { throw Error("missing owner"); }, close() {} } as unknown as DesktopConnection), directory: async () => dir, metadata: async () => { throw Error(); }, open: async () => {} };
  try {
    const result = await sendDesktopMessage({ taskId, operationId, prompt: "hello" }, deps);
    assert.equal(result.state, "not-submitted");
    assert.equal((await desktopOperation(operationId, deps)).state, "not-submitted");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const outcome of ['idle', 'active', 'timeout', 'active-writer'] as const) test(`archive ${outcome} preserves folders and deduplicates`, async () => {
  const { archiveDesktopTask } = await import('../src/main/maintenance/desktop-actions');
  const { CodexConnectionError } = await import('../src/main/maintenance/codex-client');
  const dir = await mkdtemp(join(tmpdir(), 'dex-archive-'));
  let archives = 0; let broadcasts = 0;
  const fake = { owner: async () => 'desktop', snapshot: async () => ({ id: taskId, cwd: dir, threadRuntimeStatus: { type: outcome === 'active' ? 'active' : 'idle' } }),
    archived: (id: string, cwd: string) => { assert.equal(id, taskId); assert.equal(cwd, dir); broadcasts++; }, close: () => {} } as unknown as DesktopConnection;
  const deps = { connect: async () => fake, directory: async () => dir, metadata: async () => { throw Error(); }, open: async () => { throw Error('no navigation'); },
    archiveRecord: async (id: string) => { assert.equal(id, taskId); archives++; if (outcome === 'timeout') throw Error('timeout'); if (outcome === 'active-writer') throw new CodexConnectionError('active-writer', 'PRIVATE'); } };
  try {
    const expected = outcome === 'active' || outcome === 'active-writer' ? 'rejected' : outcome === 'timeout' ? 'unconfirmed' : 'archived';
    for (let i = 0; i < 2; i++) assert.equal((await archiveDesktopTask({ taskId, operationId }, deps)).state, expected);
    assert.equal(archives, outcome === 'active' ? 0 : 1);
    assert.equal(broadcasts, outcome === 'idle' ? 1 : 0);
    if (outcome === 'active-writer') { const receipt = await desktopOperation(operationId, deps); assert.equal(receipt.failureKind, 'active-writer'); assert.match(receipt.notice!, /desktop UI/); assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('project lookup projects only catalog fields and skips stale roots', async () => {
  const { listDesktopProjects } = await import('../src/main/maintenance/desktop-projects');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'dex-projects-'));
  try {
    await writeFile(join(dir, '.codex-global-state.json'), JSON.stringify({ private: 'PRIVATE', 'local-projects': {
      dex: { id: 'dex', name: 'Dex', rootPaths: ['/nonexistent-dex-fixture', dir], secret: 'PRIVATE' },
      other: { id: 'other', name: 'Other', rootPaths: [dir] }, bad: null,
    } }));
    const result = await listDesktopProjects('dex', { home: () => dir, validate: async () => '' });
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].primaryCwd, dir);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|nonexistent/);
    assert.equal((await listDesktopProjects('unknown', { home: () => dir, validate: async () => '' })).projects.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('archive fallback is exact, permission-aware, and never retries an uncertain archive', async () => {
  const { archiveComputerFallback } = await import('../src/skills/local-agent-actions/archive-fallback');
  const { DEFAULT_CONFIG } = await import('../src/main/config/schema');
  const result = { state: 'rejected', failureKind: 'active-writer', taskId, operationId };
  for (const mode of ['pipeline', 'realtime'] as const) {
    const config = structuredClone(DEFAULT_CONFIG); config.voice.mode = mode;
    config.skills.enabled.computer = true;
    const context = { config, availableSkillIds: ['computer'], platform: 'darwin' as const };
    const ready = archiveComputerFallback(result, context) as any;
    assert.equal(ready.fallback.state, 'ready_not_performed');
    assert.equal(ready.fallback.tool, mode === 'realtime' ? 'run_task' : 'computer tools');
    assert.equal(ready.fallback.taskId, taskId);
    assert.match(ready.fallback.task, /verifyLocalAgentTaskArchive/);
    assert.match(ready.fallback.task, /permission gate/);
    assert.equal(archiveComputerFallback({ ...result, state: 'unconfirmed' }, context).state, 'unconfirmed');
    assert.ok(!('fallback' in archiveComputerFallback({ ...result, state: 'unconfirmed' }, context)));
    assert.ok(!('fallback' in archiveComputerFallback({ ...result, failureKind: 'timeout' }, context)));
    config.skills.permissions.computer = 'never';
    assert.equal((archiveComputerFallback(result, context) as any).fallback.state, 'unavailable');
    config.skills.permissions.computer = 'ask';
    assert.equal((archiveComputerFallback(result, { ...context, availableSkillIds: [] }) as any).fallback.state, 'unavailable');
  }
});
