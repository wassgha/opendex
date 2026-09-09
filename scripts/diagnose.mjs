import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const dir = process.env.OPENDEX_DIAGNOSTICS_DIR ?? join(homedir(), 'Library/Application Support/opendex/diagnostics');
const lastIndex = process.argv.indexOf('--last');
const count = Math.max(1, Math.min(20, Number(process.argv[lastIndex + 1]) || 1));
const events = [];
for (const suffix of ['.2', '.1', '']) {
  try {
    for (const line of readFileSync(join(dir, 'interactions.jsonl' + suffix), 'utf8').split('\n')) {
      try { const e = JSON.parse(line); if (Number.isFinite(e.at)) events.push(e); } catch {}
    }
  } catch {}
}
const starts = events.filter(e => e.event === 'session-start');
const sessions = starts.slice(-count).map(start => {
  const next = starts.find(e => e.at > start.at);
  const own = events.filter(e => e.sessionId === start.sessionId);
  const end = own.find(e => e.event === 'session-end');
  const until = end?.at ?? next?.at ?? Date.now();
  const related = events.filter(e => e.sessionId === start.sessionId ||
    (!e.sessionId && e.at >= start.at && e.at <= until && ['timing','desktop-request','desktop-result'].includes(e.event)));
  const calls = own.filter(e => e.event === 'tool-call');
  return {
    sessionId: start.sessionId, started: new Date(start.at).toISOString(), model: start.model,
    wakeScreen: start.wakeScreen, ended: Boolean(end || own.find(e => e.event === 'client-close')),
    transcript: own.filter(e => ['user-transcript','assistant-transcript'].includes(e.event))
      .map(e => ({ seconds: +((e.at-start.at)/1000).toFixed(3), role: e.event === 'user-transcript' ? 'user':'assistant', text: e.text, status: e.status, source: e.source, responseId: e.responseId })),
    tools: calls.map(e => {
      const done = own.find(r => r.event === 'tool-result' && r.callId === e.callId);
      return { tool: e.tool, callId: e.callId, parentCallId: e.parentCallId, targetId: done?.targetId, ms: done ? done.at-e.at : null, status: done ? done.failed ? 'failed' : done.outcome ?? 'returned' : 'pending-or-interrupted' };
    }),
    errors: own.filter(e => e.event === 'response-error'),
    cancellations: own.filter(e => e.event === 'response-done' && e.status !== 'completed'),
    playbackInterruptions: own.filter(e => e.event === 'playback-interrupted'),
    timeline: related.map(({at,...e}) => ({ seconds: +((at-start.at)/1000).toFixed(3), ...e })),
  };
});
console.log(JSON.stringify({ directory: dir, note: 'Generated transcripts are not proof of audible playback. Timings without a sessionId are correlated by time, not guaranteed causality.', sessions,
  ...(sessions.length ? {} : { message: 'No recorded voice sessions yet.', recentEvents: events.slice(-20) }) }, null, 2));
