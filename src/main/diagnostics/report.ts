import { open } from "node:fs/promises";
import { isNewSessionCommand, isSleepCommand } from "../config/voice-commands";
import { join } from "node:path";

type Event = { reportedInputProblem?: boolean; event: string; at: number; sessionId?: string; callId?: string; failed?: boolean; unresolvedOutcome?: boolean; targetId?: string; archivedOutcome?: boolean; hasOutcome?: boolean; unconfirmedClaim?: boolean; substantiveInput?: boolean; diagnosisRequest?: boolean; capabilityRefusal?: boolean; pathRequest?: boolean; newSessionRequest?: boolean; acknowledgment?: boolean; diagnosis?: boolean; playbackReason?: "speech-without-playback" | "speech-during-playback" };
export interface Finding {
  id: string;
  severity: "warning" | "info";
  title: string;
  evidence: { event: string; count: number; firstAt: number; lastAt: number; sessionIds: string[] };
  interpretation: string;
}
export interface DiagnosticReport {
  generatedAt: number;
  coverage: { filesRead: number; unreadableFiles: number; invalidLines: number; truncatedFiles: number; eventsRead: number; firstAt: number | null; lastAt: number | null; selectedSessions: number; limit: number };
  sessions: { sessionId: string; startedAt: number; ended: boolean; toolCalls: number; failedTools: number; responseErrors: number; interruptions: number }[];
  assessment: { status: "recorded-failure" | "unresolved-work" | "no-recorded-failure" | "insufficient-evidence"; summary: string; nextAction: string };
  playback: { sessionId: string; audioInterruptions: number; nonPlaybackTransitions: number; unclassifiedInterruptions: number; acknowledgmentsHandled: number }[];
  acknowledgmentFix: { state: "observed" | "not-observed"; count: number; sessionIds: string[]; interpretation: string };
  scope: { diagnosticSessionsExcluded: number; selection: "recent-sessions" | "recent-nondiagnostic-interactions" };
  pipeline: { requests: number; results: number; failedResults: number; correlation: "unavailable" };
  findings: Finding[];
  limitations: string[];
}

// Strict projection: never return transcript text, arbitrary tool payloads,
// provider errors, config values, audio or images from a diagnostic report.
function parseEvent(value: unknown, wakeWord: string): Event | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.event !== "string" || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  const id = (x: unknown) => typeof x === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(x) ? x : undefined;
  const transcript = typeof v.text === "string" ? v.text : "";
  const user = v.event === "user-transcript";
  const assistant = v.event === "assistant-transcript";
  const diagnosisRequest = user && /\b(?:diagnos(?:eDex|e|ed|is|tic)|review.*(?:last|previous).*session|inspect.*(?:last|previous).*session)\b/i.test(transcript);
  return { reportedInputProblem: user && /\b(?:(?:i|we) (?:never|didn[’']?t|did not) (?:say|said)|(?:you|dex) (?:(?:keep )?missing|misheard|heard things|invented|made up)|(?:have to|must) repeat (?:myself|ourselves)|(?:wrong|unrelated) (?:task|action|response))\b/i.test(transcript), substantiveInput: user && !diagnosisRequest && !isSleepCommand(transcript, wakeWord) && transcript.toLowerCase().replace(/[.!?,]/g, "").trim() !== wakeWord.toLowerCase().trim() && !/^(?:okay|ok|yeah|yes|thanks|thank you)[.!?,\s]*$/i.test(transcript.trim()), diagnosisRequest,
    newSessionRequest: user && isNewSessionCommand(transcript, wakeWord),
    hasOutcome: v.event === "tool-result" && typeof v.outcome === "string",
    targetId: id(v.targetId), archivedOutcome: v.event === "tool-result" && v.outcome === "archived",
    unresolvedOutcome: v.event === "tool-result" && ["unarchived", "unconfirmed", "not-submitted", "created-unsubmitted", "rejected", "unsupported"].includes(String(v.outcome)),
    unconfirmedClaim: assistant && /\b(?:archive|archival|actions?|operations?)\b/i.test(transcript) && /\b(?:unconfirmed|not confirmed)\b/i.test(transcript),
    capabilityRefusal: assistant && /\b(?:can[’']?t|cannot|not from here)\b/i.test(transcript) && /\b(?:archiv\w*|capability|connection|support)\b/i.test(transcript),
    pathRequest: assistant && /\b(?:need|paste|provide)\b/i.test(transcript) && /absolute folder path/i.test(transcript),
    event: v.event, at: v.at, sessionId: id(v.sessionId), callId: id(v.callId), failed: v.failed === true, acknowledgment: v.event === "user-transcript" && typeof v.text === "string" && /^(?:yeah|yep|yes|okay|ok|right|m+h+m+|uh[ -]?huh)[.!?,\s]*$/i.test(v.text.trim()), diagnosis: v.event === "tool-call" && v.tool === "diagnoseDex",
    playbackReason: v.reason === "speech-without-playback" || v.reason === "speech-during-playback" ? v.reason : undefined };
}

/** Async and bounded so inspection does not block the main voice process. */
export async function readDiagnosticReport(directory: string, last = 3, now = Date.now(), options: { excludeDiagnosticSessions?: boolean; wakeWord?: string } = {}): Promise<DiagnosticReport> {
  const limit = Number.isFinite(last) ? Math.max(1, Math.min(20, Math.floor(last))) : 3;
  const events: Event[] = [];
  const coverage: DiagnosticReport["coverage"] = { filesRead: 0, unreadableFiles: 0, invalidLines: 0, truncatedFiles: 0, eventsRead: 0, firstAt: null, lastAt: null, selectedSessions: 0, limit };
  for (const suffix of [".2", ".1", ""]) {
    let file;
    try {
      file = await open(join(directory, "interactions.jsonl" + suffix), "r");
      const stat = await file.stat();
      const size = Math.min(stat.size, 6_000_000);
      const offset = stat.size - size;
      const buffer = Buffer.alloc(size);
      let total = 0;
      while (total < size) {
        const { bytesRead } = await file.read(buffer, total, size - total, offset + total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      let content = buffer.subarray(0, total).toString("utf8");
      if (offset > 0) { coverage.truncatedFiles++; content = content.slice(content.indexOf("\n") + 1); }
      coverage.filesRead++;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = parseEvent(JSON.parse(line), options.wakeWord ?? "dex");
          if (event) events.push(event); else coverage.invalidLines++;
        } catch { coverage.invalidLines++; }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") coverage.unreadableFiles++;
    } finally { await file?.close(); }
  }
  events.sort((a, b) => a.at - b.at);
  coverage.eventsRead = events.length;
  coverage.firstAt = events[0]?.at ?? null;
  coverage.lastAt = events.at(-1)?.at ?? null;
  const diagnosticIds = new Set(events.filter(e => e.diagnosis && e.sessionId).map(e => e.sessionId));
  const excludedIds = new Set([...diagnosticIds].filter(id => !events.some(e => e.sessionId === id && (e.substantiveInput || e.reportedInputProblem))));
  // Keep mixed sessions. For an ongoing diagnosis, inspect only the work before
  // the diagnosis request so the report cannot assess its own unfinished call.
  const cutoffs = new Map<string, number>();
  if (options.excludeDiagnosticSessions) for (const id of diagnosticIds) {
    const own = events.filter(e => e.sessionId === id);
    if (!own.some(e => e.event === "session-end")) {
      const call = own.filter(e => e.diagnosis).at(-1)!;
      const request = own.filter(e => e.diagnosisRequest && e.at <= call.at).at(-1);
      cutoffs.set(id!, request?.at ?? call.at);
    }
  }
  const starts = events.filter(e => e.event === "session-start" && e.sessionId && (!options.excludeDiagnosticSessions || !excludedIds.has(e.sessionId))).slice(-limit);
  const sessionIds = new Set(starts.map(e => e.sessionId));
  const selected = events.filter(e => e.sessionId && sessionIds.has(e.sessionId) && (e.at < (cutoffs.get(e.sessionId) ?? Infinity) || (e.reportedInputProblem && e.at === cutoffs.get(e.sessionId))));
  const count = (rows: Event[], name: string) => rows.filter(e => e.event === name).length;
  const sessions = starts.map(start => {
    const own = selected.filter(e => e.sessionId === start.sessionId);
    return { sessionId: start.sessionId!, startedAt: start.at,
      ended: own.some(e => e.event === "session-end"), toolCalls: count(own, "tool-call"),
      failedTools: own.filter(e => e.event === "tool-result" && e.failed).length,
      responseErrors: count(own, "response-error"), interruptions: count(own, "playback-interrupted") };
  });
  coverage.selectedSessions = sessions.length;
  // Pipeline events lack session IDs. Keep their counts separate, across the
  // whole retained window; never imply causal pairing by time alone.
  const pipelineEvents = events.filter(e => !e.sessionId && ["desktop-request", "desktop-result"].includes(e.event));
  const failures = selected.filter(e => e.event === "tool-result" && e.failed);
  const responseErrors = selected.filter(e => e.event === "response-error");
  const pipelineFailures = pipelineEvents.filter(e => e.event === "desktop-result" && e.failed);
  const findings: Finding[] = [];
  const add = (id: string, title: string, rows: Event[], interpretation: string) => {
    if (!rows.length) return;
    findings.push({ id, severity: "warning", title,
      evidence: { event: rows[0].event, count: rows.length, firstAt: rows[0].at, lastAt: rows.at(-1)!.at,
        sessionIds: [...new Set(rows.flatMap(e => e.sessionId ? [e.sessionId] : []))] }, interpretation });
  };
  add("tool-failures", "Tools reported failures", failures, "A tool returned an error flag. The cause and impact need investigation; this does not establish a code defect.");
  add("response-errors", "Realtime responses reported errors", responseErrors, "The provider reported errors. Configuration, connectivity, and provider behavior have not been distinguished.");
  add("pipeline-failures", "Pipeline requests reported failures", pipelineFailures, "These events cover all retained history and cannot yet be reliably linked to individual voice turns.");
  const unresolvedOutcomes = selected.filter(e => e.unresolvedOutcome && !(e.targetId && selected.some(later => later.sessionId === e.sessionId && later.targetId === e.targetId && later.archivedOutcome && later.at > e.at)));
  // Legacy sessions lack structured outcomes. Prefer exact result/readback evidence when available.
  const unconfirmedClaims = selected.filter(e => e.unconfirmedClaim && !selected.some(other => other.sessionId === e.sessionId && other.hasOutcome));
  add("unresolved-tool-outcome", "Tool operations were not confirmed or not completed", unresolvedOutcomes,
    "A structured tool result reports an unconfirmed, unsubmitted, rejected or unsupported operation. Returning a result is not completion. Inspect the operation receipt before retrying; an uncertain operation may have taken effect.");
  add("unconfirmed-operation-report", "Dex reported an unconfirmed operation", unconfirmedClaims,
    "A bounded transcript classifier found an unconfirmed action report. This is historical evidence of unresolved work, not proof of the underlying cause or final task state. Inspect the saved operation receipt and current task state before retrying.");
  const missedResults: Event[] = [];
  const pendingAtEnd: Event[] = [];
  for (const start of starts) {
    const own = selected.filter(e => e.sessionId === start.sessionId);
    const end = own.find(e => e.event === "client-close" || e.event === "session-end");
    for (const call of own.filter(e => e.event === "tool-call" && e.callId)) {
      const result = own.find(e => e.event === "tool-result" && e.callId === call.callId && e.at >= call.at);
      if (!result) { if (end) pendingAtEnd.push(call); continue; }
      // A new generation already in flight when the result arrived cannot be
      // assumed to have used it. Require a response started after the result.
      const between = own.filter(e => e.event === "user-transcript" && e.at > call.at && e.at < result.at);
      const onlyAcknowledgments = between.length > 0 && between.every(e => e.acknowledgment);
      const nextInput = own.find(e => e.event === "user-transcript" && e.at > result.at);
      const deadline = nextInput?.at ?? end?.at ?? now;
      const answered = own.some(e => e.event === "response-created" && e.at >= result.at && e.at < deadline);
      if (onlyAcknowledgments && !answered && deadline - result.at >= 30000) missedResults.push(result);
    }
  }
  add("undelivered-tool-result", "A tool returned after an acknowledgment but no result-based reply followed", missedResults,
    "The request was acknowledged while a tool was pending. Its result arrived, but no subsequent response began for at least 30 seconds. The answer may have been dropped when the acknowledgment superseded the original request. Investigate continuation scheduling, not just tool error flags.");
  add("tools-pending-at-close", "A session closed with tool results still unrecorded", pendingAtEnd,
    "These tool calls have no matching recorded result before session closure. They may have been stopped intentionally; report unfinished work rather than declaring success or inventing a tool failure.");
  const refusals = selected.filter(e => e.capabilityRefusal);
  const paths = selected.filter(e => e.pathRequest);
  const missedRestarts = selected.filter(e => e.newSessionRequest && selected.some(next => next.sessionId === e.sessionId && next.event === "assistant-transcript" && next.at > e.at && next.at - e.at < 15000) && !selected.some(next => next.sessionId === e.sessionId && next.event === "session-end" && next.at >= e.at && next.at - e.at < 15000));
  add("capability-refusal", "Dex reported it could not perform an action", refusals,
    "A bounded transcript classifier detected a capability refusal. This can leave the request unmet even without a tool error. Check available tools and permissions; the refusal alone does not prove the capability is missing.");
  add("project-path-request", "Dex asked the user to supply an absolute folder path", paths,
    "Check whether named-project or task discovery already provides a usable folder before asking the user to paste one. This is a possible discovery gap, not proof a path was available.");
  add("new-session-not-restarted", "A new-session command received a reply in the same session", missedRestarts,
    "An exact restart request was followed by an assistant transcript without a recorded session end within fifteen seconds. Inspect deterministic command recognition; a spoken acknowledgment does not restart the connection.");
  const playback = starts.map(start => {
    const own = selected.filter(e => e.sessionId === start.sessionId);
    const interruptions = own.filter(e => e.event === "playback-interrupted");
    return { sessionId: start.sessionId!, audioInterruptions: interruptions.filter(e => e.playbackReason === "speech-during-playback").length,
      nonPlaybackTransitions: interruptions.filter(e => e.playbackReason === "speech-without-playback").length,
      unclassifiedInterruptions: interruptions.filter(e => !e.playbackReason).length,
      acknowledgmentsHandled: count(own, "playback-acknowledgment-ignored") + count(own, "work-acknowledgment-ignored") };
  });
  const handled = playback.filter(p => p.acknowledgmentsHandled > 0);
  const incompleteCoverage = !sessions.length || coverage.invalidLines > 0 || coverage.unreadableFiles > 0 || coverage.truncatedFiles > 0;
  // Uncorrelated pipeline failures must not become a verdict on this session.
  const inputComplaints = selected.filter(e => e.reportedInputProblem);
  const rejectedSpeech = selected.filter(e => e.event === "playback-nonspeech-rejected");
  add("reported-input-problem", "User reported incorrect input or unrelated behavior", inputComplaints,
    "The user's correction is evidence of an unresolved interaction problem even when tools succeed. Do not attribute disputed words to the user or dismiss the report because no execution error exists. Inspect the turn's speech evidence and actions.");
  add("speech-input-rejected", "Speech filter discarded uncertain input", rejectedSpeech,
    "The filter prevented an input turn from triggering a response. This does not prove an echo or a successful microphone experience; verify that real speech was not lost.");
  const hasFailure = failures.length > 0 || responseErrors.length > 0;
  const unresolved = inputComplaints.length > 0 || unresolvedOutcomes.length > 0 || unconfirmedClaims.length > 0 || missedResults.length > 0 || pendingAtEnd.length > 0 || refusals.length > 0 || paths.length > 0 || missedRestarts.length > 0;
  const assessment: DiagnosticReport["assessment"] = {
    status: hasFailure ? "recorded-failure" : unresolved ? "unresolved-work" : incompleteCoverage ? "insufficient-evidence" : "no-recorded-failure",
    summary: hasFailure ? "The selected sessions contain recorded tool or response failures."
      : unresolved ? "The history contains possible unmet requests or unfinished work. Inspect the findings for the specific evidence."
      : incompleteCoverage ? "The available history is insufficient for a reliable session assessment."
      : "No tool failures or response errors were recorded. This does not check whether Dex heard you correctly or acted on the right request.",
    nextAction: hasFailure ? "Inspect the events referenced by the failure findings before proposing a repair."
      : unresolved ? "Inspect the unfinished-work findings. A successful tool return does not establish that the user received an answer."
      : incompleteCoverage ? "Check missing or damaged history before drawing a conclusion."
      : "Inspect the reported symptom and its event sequence. Successful execution cannot rule out false transcription, unwanted interruptions or unrelated actions.",
  };
  return { generatedAt: now, coverage, sessions, assessment, playback,
    scope: { diagnosticSessionsExcluded: options.excludeDiagnosticSessions ? excludedIds.size : 0, selection: options.excludeDiagnosticSessions ? "recent-nondiagnostic-interactions" : "recent-sessions" },
    acknowledgmentFix: { state: handled.length ? "observed" : "not-observed", count: handled.reduce((n, p) => n + p.acknowledgmentsHandled, 0), sessionIds: handled.map(p => p.sessionId),
      interpretation: handled.length ? "The acknowledgment guard preserved ongoing playback or pending work. This verifies the code path was exercised, not audible quality."
        : "No acknowledgment-guard event occurred in these sessions. The fix was not exercised here; this does not mean it failed." },
    pipeline: { requests: count(pipelineEvents, "desktop-request"), results: count(pipelineEvents, "desktop-result"), failedResults: pipelineFailures.length, correlation: "unavailable" },
    findings,
    limitations: [
      "No findings means no matching recorded errors, not proof Dex is healthy.",
      "Transcript classifiers are narrow heuristics for refusals, path requests, and restart commands; they are not comprehensive task-success evaluation.",
      "History rotates; missing, unreadable, truncated, or malformed records reduce coverage.",
      "Session-level history primarily covers realtime. Pipeline counts cover all retained files and lack turn correlation.",
      "speech-without-playback is a normal turn transition, not cut-off audio. Actual playback interruptions can be intentional; no session-end means completion is unknown, not failure.",
      "Generated transcripts do not prove audible playback. Audio and images are not recorded by diagnostics.",
      "This report contains aggregate evidence only. It cannot reconstruct unrecorded interactions or establish root causes.",
    ] };
}
