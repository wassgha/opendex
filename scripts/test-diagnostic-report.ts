import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDiagnosticReport } from "../src/main/diagnostics/report";

async function fixture(run: (directory: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "dex-report-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const jsonl = (events: unknown[]) => events.map(e => JSON.stringify(e)).join("\n") + "\n";

test("false-input complaints remain unresolved despite successful tools", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "s", at: 1 },
    { event: "user-transcript", sessionId: "s", at: 2, text: "I never said any of that PRIVATE" },
    { event: "tool-result", sessionId: "s", at: 3, failed: false },
  ]));
  const report = await readDiagnosticReport(dir);
  assert.equal(report.assessment.status, "unresolved-work");
  assert.ok(report.findings.some(f => f.id === "reported-input-problem"));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
}));

test("clean execution explicitly leaves hearing and intent unverified", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([{ event: "session-start", sessionId: "s", at: 1 }]));
  const report = await readDiagnosticReport(dir);
  assert.match(report.assessment.summary, /does not check whether Dex heard you correctly/);
  assert.match(report.assessment.nextAction, /false transcription/);
}));

test("reports selected realtime failures and separate pipeline evidence without private content", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl.1"), jsonl([
    { event: "session-start", at: 1, sessionId: "old" },
    { event: "response-error", at: 2, sessionId: "old", message: "PRIVATE" },
    { event: "desktop-request", at: 3, text: "PRIVATE" },
    { event: "desktop-result", at: 4, text: "PRIVATE", failed: true },
  ]));
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", at: 5, sessionId: "new" },
    { event: "user-transcript", at: 6, sessionId: "new", text: "PRIVATE" },
    { event: "tool-call", at: 7, sessionId: "new", callId: "call", input: { password: "PRIVATE" } },
    { event: "tool-result", at: 8, sessionId: "new", callId: "call", failed: true, output: "PRIVATE" },
    { event: "response-error", at: 9, sessionId: "new", message: "PRIVATE" },
    { event: "playback-interrupted", at: 10, sessionId: "new" },
  ]));
  const report = await readDiagnosticReport(dir, 1, 20);
  assert.equal(report.generatedAt, 20);
  assert.equal(report.coverage.filesRead, 2);
  assert.deepEqual(report.sessions, [{ sessionId: "new", startedAt: 5, ended: false, toolCalls: 1, failedTools: 1, responseErrors: 1, interruptions: 1 }]);
  assert.equal(report.findings.find(f => f.id === "response-errors")?.evidence.count, 1);
  assert.equal(report.pipeline.failedResults, 1);
  assert.equal(report.pipeline.correlation, "unavailable");
  assert.ok(!JSON.stringify(report).includes("PRIVATE"));
  assert.equal(report.findings.length, 3);
}));

test("missing history and malformed lines do not become a clean bill of health", () => fixture(async dir => {
  const empty = await readDiagnosticReport(dir);
  assert.equal(empty.coverage.filesRead, 0);
  assert.match(empty.limitations[0], /not proof/);
  await writeFile(join(dir, "interactions.jsonl"), 'null\n{}\n{"event":"x","at":"invalid"}\n{"event":');
  const bad = await readDiagnosticReport(dir, NaN);
  assert.equal(bad.coverage.invalidLines, 4);
  assert.equal(bad.coverage.eventsRead, 0);
  assert.equal(bad.coverage.limit, 3);
}));

test("unreadable history and oversized files are explicitly reported", () => fixture(async dir => {
  await mkdir(join(dir, "interactions.jsonl.1"));
  await writeFile(join(dir, "interactions.jsonl"), "x".repeat(6_000_010) + "\n" + jsonl([{ event: "session-start", at: 2, sessionId: "retained" }]));
  const result = await readDiagnosticReport(dir);
  assert.equal(result.coverage.unreadableFiles, 1);
  assert.equal(result.coverage.truncatedFiles, 1);
  assert.equal(result.sessions[0]?.sessionId, "retained");
}));

test("interruptions and missing session-end do not invent defects", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "active", at: 1 },
    { event: "playback-interrupted", sessionId: "active", at: 2 },
    { event: "response-done", sessionId: "active", at: 3, status: "cancelled" },
  ]));
  const result = await readDiagnosticReport(dir, 999);
  assert.equal(result.coverage.limit, 20);
  assert.equal(result.sessions[0].ended, false);
  assert.equal(result.findings.length, 0);
}));

test("previous-session diagnosis excludes itself and does not confuse silent transitions with cutoffs", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "previous", at: 1 },
    { event: "playback-interrupted", sessionId: "previous", at: 2, reason: "speech-without-playback" },
    { event: "session-end", sessionId: "previous", at: 3 },
    { event: "session-start", sessionId: "diagnosis", at: 4 },
    { event: "tool-call", sessionId: "diagnosis", at: 5, tool: "diagnoseDex" },
  ]));
  const report = await readDiagnosticReport(dir, 1, 6, { excludeDiagnosticSessions: true });
  assert.equal(report.sessions[0].sessionId, "previous");
  assert.equal(report.scope.diagnosticSessionsExcluded, 1);
  assert.equal(report.assessment.status, "no-recorded-failure");
  assert.equal(report.playback[0].nonPlaybackTransitions, 1);
  assert.equal(report.playback[0].audioInterruptions, 0);
  assert.equal(report.acknowledgmentFix.state, "not-observed");
}));

test("guard evidence is distinguished from actual and unknown interruptions without diagnosing a defect", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "s", at: 1 },
    { event: "playback-acknowledgment-ignored", sessionId: "s", at: 2 },
    { event: "playback-interrupted", sessionId: "s", at: 3, reason: "speech-during-playback" },
    { event: "playback-interrupted", sessionId: "s", at: 4, reason: "PRIVATE" },
  ]));
  const report = await readDiagnosticReport(dir);
  assert.equal(report.acknowledgmentFix.state, "observed");
  assert.equal(report.acknowledgmentFix.count, 1);
  assert.equal(report.playback[0].audioInterruptions, 1);
  assert.equal(report.playback[0].unclassifiedInterruptions, 1);
  assert.equal(report.assessment.status, "no-recorded-failure");
  assert.equal(report.findings.length, 0);
  assert.ok(!JSON.stringify(report).includes("PRIVATE"));
}));

test("successful tool result without a continuation after okay is unresolved work", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "stuck", at: 0 },
    { event: "tool-call", sessionId: "stuck", callId: "lookup", at: 9000 },
    { event: "response-done", sessionId: "stuck", at: 9035 },
    { event: "user-transcript", sessionId: "stuck", text: "Okay", at: 13956 },
    { event: "response-created", sessionId: "stuck", at: 14109 },
    { event: "tool-result", sessionId: "stuck", callId: "lookup", failed: false, at: 14229 },
    { event: "response-done", sessionId: "stuck", at: 16441 },
    { event: "client-close", sessionId: "stuck", at: 48045 },
  ]));
  const report = await readDiagnosticReport(dir, 1, 50000);
  assert.equal(report.assessment.status, "unresolved-work");
  assert.equal(report.findings[0].id, "undelivered-tool-result");
  assert.equal(report.sessions[0].failedTools, 0);
}));

test("real redirection and a prompt result continuation do not become missed answers", () => fixture(async dir => {
  for (const redirect of [true, false]) {
    await writeFile(join(dir, "interactions.jsonl"), jsonl([
      { event: "session-start", sessionId: "s", at: 0 },
      { event: "tool-call", sessionId: "s", callId: "c", at: 1 },
      { event: "user-transcript", sessionId: "s", text: redirect ? "Cancel that" : "Okay", at: 2 },
      { event: "tool-result", sessionId: "s", callId: "c", at: 3 },
      ...(!redirect ? [{ event: "response-created", sessionId: "s", at: 4 }] : []),
      { event: "session-end", sessionId: "s", at: 50000 },
    ]));
    assert.equal((await readDiagnosticReport(dir, 1, 60000)).findings.length, 0);
  }
}));

test('mixed sessions retain unmet requests without leaking text or diagnosing their own call', () => fixture(async dir => {
  await writeFile(join(dir, 'interactions.jsonl'), jsonl([
    { event: 'session-start', sessionId: 'mixed', at: 1000 },
    { event: 'user-transcript', sessionId: 'mixed', at: 2000, text: 'Archive this task PRIVATE' },
    { event: 'assistant-transcript', sessionId: 'mixed', at: 3000, text: 'I can’t archive it from here PRIVATE' },
    { event: 'user-transcript', sessionId: 'mixed', at: 4000, text: 'Okay, new session.' },
    { event: 'assistant-transcript', sessionId: 'mixed', at: 5000, text: 'Fresh start PRIVATE' },
    { event: 'assistant-transcript', sessionId: 'mixed', at: 6000, text: 'I need the absolute folder path PRIVATE' },
    { event: 'user-transcript', sessionId: 'mixed', at: 7000, text: 'Diagnose the last session' },
    { event: 'tool-call', sessionId: 'mixed', at: 8000, tool: 'diagnoseDex', callId: 'diagnosis' },
  ]));
  const report = await readDiagnosticReport(dir, 1, 20000, { excludeDiagnosticSessions: true });
  assert.equal(report.sessions[0].sessionId, 'mixed');
  assert.equal(report.sessions[0].toolCalls, 0);
  assert.equal(report.assessment.status, 'unresolved-work');
  for (const id of ['capability-refusal', 'project-path-request', 'new-session-not-restarted']) assert.ok(report.findings.some(f => f.id === id), id);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|Fresh start/);
}));

test('completed mixed sessions remain eligible for last-session review', () => fixture(async dir => {
  await writeFile(join(dir, 'interactions.jsonl'), jsonl([
    { event: 'session-start', sessionId: 'mixed', at: 1 },
    { event: 'user-transcript', sessionId: 'mixed', at: 2, text: 'Find a task' },
    { event: 'tool-call', sessionId: 'mixed', at: 3, tool: 'diagnoseDex' },
    { event: 'session-end', sessionId: 'mixed', at: 4 },
    { event: 'session-start', sessionId: 'diagnosis', at: 5 },
    { event: 'user-transcript', sessionId: 'diagnosis', at: 6, text: 'Diagnose the last session' },
    { event: 'tool-call', sessionId: 'diagnosis', at: 7, tool: 'diagnoseDex' },
    { event: 'user-transcript', sessionId: 'diagnosis', at: 8, text: 'Go to sleep.' },
    { event: 'session-end', sessionId: 'diagnosis', at: 9 },
  ]));
  const report = await readDiagnosticReport(dir, 1, 8, { excludeDiagnosticSessions: true });
  assert.equal(report.sessions[0].sessionId, 'mixed');
}));

test('unconfirmed archive history remains unresolved when every tool returned without an error', () => fixture(async dir => {
  await writeFile(join(dir, 'interactions.jsonl'), jsonl([
    { event: 'session-start', sessionId: 'archive', at: 1 },
    { event: 'user-transcript', sessionId: 'archive', at: 2, text: 'Review our sessions and see if we can archive any.' },
    { event: 'tool-call', sessionId: 'archive', at: 3, callId: 'a', tool: 'archiveLocalAgentTask' },
    { event: 'tool-result', sessionId: 'archive', at: 4, callId: 'a', failed: false },
    { event: 'assistant-transcript', sessionId: 'archive', at: 5, text: 'The archive actions came back unconfirmed. PRIVATE' },
    { event: 'session-end', sessionId: 'archive', at: 6 },
    { event: 'session-start', sessionId: 'diagnosis', at: 7 },
    { event: 'user-transcript', sessionId: 'diagnosis', at: 8, text: 'Diagnosed the last session.' },
    { event: 'tool-call', sessionId: 'diagnosis', at: 9, tool: 'diagnoseDex' },
    { event: 'user-transcript', sessionId: 'diagnosis', at: 10, text: 'Dex' },
    { event: 'session-end', sessionId: 'diagnosis', at: 11 },
  ]));
  const report = await readDiagnosticReport(dir, 1, 20, { excludeDiagnosticSessions: true });
  assert.equal(report.sessions[0].sessionId, 'archive');
  assert.equal(report.assessment.status, 'unresolved-work');
  assert.equal(report.findings[0].id, 'unconfirmed-operation-report');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
}));

test('structured incomplete outcomes are projected without private payloads or invented tool errors', () => fixture(async dir => {
  const { diagnosticToolOutcome } = await import('../src/main/diagnostics/tool-outcome');
  for (const state of ['unarchived', 'unconfirmed', 'rejected', 'unsupported', 'not-submitted', 'created-unsubmitted', 'accepted', 'archived']) {
    const projected = diagnosticToolOutcome({ state, notice: 'PRIVATE', prompt: 'PRIVATE' });
    assert.deepEqual(projected, { failed: false, outcome: state });
    await writeFile(join(dir, 'interactions.jsonl'), jsonl([
      { event: 'session-start', sessionId: 's', at: 1 },
      { event: 'tool-result', sessionId: 's', at: 2, ...projected },
    ]));
    const report = await readDiagnosticReport(dir);
    assert.equal(report.assessment.status, ['accepted', 'archived'].includes(state) ? 'no-recorded-failure' : 'unresolved-work');
    assert.equal(report.sessions[0].failedTools, 0);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
  assert.deepEqual(diagnosticToolOutcome({ state: 'PRIVATE', error: 'PRIVATE' }), { failed: true });
}));

test('task review in a mixed diagnostic session is substantive and custom wake-only speech is not', () => fixture(async dir => {
  await writeFile(join(dir, 'interactions.jsonl'), jsonl([
    { event: 'session-start', sessionId: 'mixed', at: 1 },
    { event: 'user-transcript', sessionId: 'mixed', at: 2, text: 'Review our Codex sessions and see if we can archive any.' },
    { event: 'tool-call', sessionId: 'mixed', at: 3, tool: 'diagnoseDex' },
    { event: 'session-end', sessionId: 'mixed', at: 4 },
    { event: 'session-start', sessionId: 'diagnosis', at: 5 },
    { event: 'user-transcript', sessionId: 'diagnosis', at: 6, text: 'Atlas!' },
    { event: 'tool-call', sessionId: 'diagnosis', at: 7, tool: 'diagnoseDex' },
    { event: 'session-end', sessionId: 'diagnosis', at: 8 },
  ]));
  const report = await readDiagnosticReport(dir, 1, 9, { excludeDiagnosticSessions: true, wakeWord: 'atlas' });
  assert.equal(report.sessions[0].sessionId, 'mixed');
}));

test('verified archival resolves the same target only, while legacy claims cannot override readback', () => fixture(async dir => {
  for (const sameTarget of [true, false]) {
    await writeFile(join(dir, 'interactions.jsonl'), jsonl([
      { event: 'session-start', sessionId: 's', at: 1 },
      { event: 'tool-result', sessionId: 's', targetId: 'task-a', outcome: 'rejected', at: 2 },
      { event: 'assistant-transcript', sessionId: 's', text: 'The archive action was not confirmed', at: 3 },
      { event: 'tool-result', sessionId: 's', targetId: sameTarget ? 'task-a' : 'task-b', outcome: 'archived', at: 4 },
    ]));
    assert.equal((await readDiagnosticReport(dir)).assessment.status, sameTarget ? 'no-recorded-failure' : 'unresolved-work');
  }
}));

test("missed-speech complaints are unmet work even when execution succeeds", () => fixture(async dir => {
  await writeFile(join(dir, "interactions.jsonl"), jsonl([
    { event: "session-start", sessionId: "s", at: 1 },
    { event: "user-transcript", sessionId: "s", at: 2, text: "You keep missing things I say and I have to repeat myself PRIVATE" },
    { event: "tool-result", sessionId: "s", at: 3, failed: false },
  ]));
  const report = await readDiagnosticReport(dir);
  assert.equal(report.assessment.status, "unresolved-work");
  assert.ok(report.findings.some(f => f.id === "reported-input-problem"));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
}));

test("a named diagnostic tool request selects prior work, while a hearing complaint stays visible", () => fixture(async dir => {
  const history = [
    { event: "session-start", sessionId: "bad", at: 1 },
    { event: "user-transcript", sessionId: "bad", at: 2, text: "Diagnose why you keep missing what I say" },
    { event: "tool-call", sessionId: "bad", at: 3, tool: "diagnoseDex" },
    { event: "session-end", sessionId: "bad", at: 4 },
    { event: "session-start", sessionId: "inspection", at: 5 },
    { event: "user-transcript", sessionId: "inspection", at: 6, text: "Run diagnoseDex for the last voice session." },
    { event: "tool-call", sessionId: "inspection", at: 7, tool: "diagnoseDex" },
  ];
  await writeFile(join(dir, "interactions.jsonl"), jsonl(history));
  const report = await readDiagnosticReport(dir, 1, 8, { excludeDiagnosticSessions: true });
  assert.equal(report.sessions[0].sessionId, "bad");
  assert.equal(report.assessment.status, "unresolved-work");
  // The same complaint must survive the ongoing diagnosis cutoff.
  await writeFile(join(dir, "interactions.jsonl"), jsonl(history.slice(0, 3)));
  const current = await readDiagnosticReport(dir, 1, 4, { excludeDiagnosticSessions: true });
  assert.equal(current.assessment.status, "unresolved-work");
  assert.equal(current.sessions[0].toolCalls, 0);
}));
