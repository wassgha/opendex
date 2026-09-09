import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const control = z.object({ id, label: z.string().min(1).max(120), kind: z.enum(['button', 'input', 'select']), options: z.array(z.string().max(120)).max(20).optional() }).strict();
const step = z.object({ title: z.string().max(120), controls: z.array(control).min(1).max(20), success: z.object({ target: id, values: z.record(id, z.string().max(200)) }).strict() }).strict();
export const suiteSchema = z.object({ version: z.literal(1), id, scenarios: z.array(z.object({ id, task: z.string().min(1).max(1000), budgetMs: z.number().int().min(1000).max(600000), steps: z.array(step).min(1).max(10) }).strict()).min(3).max(5) }).strict().superRefine((suite, ctx) => {
  if (new Set(suite.scenarios.map(s => s.id)).size !== suite.scenarios.length) ctx.addIssue({ code: 'custom', message: 'Duplicate scenario IDs' });
  for (const s of suite.scenarios) for (const p of s.steps) {
    if (new Set(p.controls.map(c => c.id)).size !== p.controls.length || !p.controls.some(c => c.id === p.success.target && c.kind === 'button')) ctx.addIssue({ code: 'custom', message: 'Each step needs unique controls and a success button' });
    for (const [key, value] of Object.entries(p.success.values)) {
      const c = p.controls.find(c => c.id === key);
      if (!c || c.kind === 'button' || (c.kind === 'select' && !c.options?.includes(value))) ctx.addIssue({ code: 'custom', message: 'Success value must match an editable control' });
    }
    if (p.controls.some(c => c.kind === 'select' && !c.options?.length)) ctx.addIssue({ code: 'custom', message: 'Select requires options' });
  }
});
export type Suite = z.infer<typeof suiteSchema>;
export const eventSchema = z.object({ revision: z.number().int().nonnegative(), target: z.string().max(48), values: z.record(id, z.string().max(200)), x: z.number().finite(), y: z.number().finite() }).strict();
export type Click = z.infer<typeof eventSchema>;
export type Row = { id: string; status: 'success' | 'timeout' | 'aborted' | 'not-run'; elapsedMs: number | null; misclicks: number; invalidSubmissions: number; score: number; completedSteps: number; transition?: string };
export const fingerprint = (suite: Suite) => createHash('sha256').update(JSON.stringify({ fixtureVersion: 2, suite })).digest('hex');
export class Benchmark {
  index = 0;
  step = 0;
  revision = 0;
  started: number | null = null;
  rows: Row[] = [];
  events: Array<Click & { scenario: string; step: number; elapsedMs: number; outcome: string }> = [];
  private misclicks = 0;
  private invalid = 0;
  constructor(readonly suite: Suite, private now = () => performance.now()) {}
  get current() { return this.suite.scenarios[this.index]; }
  start() { if (this.current && this.started === null) { this.started = this.now(); this.revision++; } }
  tick() { if (this.started !== null && this.now() - this.started >= this.current.budgetMs) this.finish('timeout'); }
  click(event: Click) {
    this.tick();
    if (!this.current || this.started === null || event.revision !== this.revision) return;
    if (this.events.length >= 10000) { this.finish('aborted'); return; }
    const p = this.current.steps[this.step];
    const c = p.controls.find(c => c.id === event.target);
    let outcome = 'focus';
    if (!c || (c.kind === 'button' && c.id !== p.success.target)) { this.misclicks++; outcome = 'misclick'; }
    else if (c.kind === 'button') {
      if (Object.entries(p.success.values).every(([k, v]) => event.values[k] === v)) outcome = 'step-success';
      else { this.invalid++; outcome = 'invalid-submission'; }
    }
    // Only fixture fields are retained; never accept arbitrary page payloads.
    const values = Object.fromEntries(p.controls.filter(c => c.kind !== 'button').map(c => [c.id, event.values[c.id] ?? '']));
    this.events.push({ ...event, values, scenario: this.current.id, step: this.step, elapsedMs: Math.max(0, Math.round(this.now() - this.started)), outcome });
    if (outcome === 'step-success') {
      this.step++; this.revision++;
      if (this.step === this.current.steps.length) this.finish('success');
    }
  }
  finish(status: Row['status']) {
    if (!this.current) return;
    const elapsedMs = this.started === null ? null : Math.min(this.current.budgetMs, Math.max(0, Math.round(this.now() - this.started)));
    const score = status === 'success' ? Math.round(100 * (0.7 + 0.2 * (1 - elapsedMs! / this.current.budgetMs) + 0.1 / (1 + this.misclicks + this.invalid))) : 0;
    this.rows.push({ id: this.current.id, status, elapsedMs, misclicks: this.misclicks, invalidSubmissions: this.invalid, score, completedSteps: this.step });
    this.index++; this.step = 0; this.started = null; this.misclicks = 0; this.invalid = 0; this.revision++;
  }
  stopReason?: string;
  stop(reason?: string) { this.stopReason ??= reason; while (this.current) this.finish(this.started === null ? 'not-run' : 'aborted'); }
}
export type Report = { version: 1; suiteHash: string; suite: Suite; environment: string; stopReason?: string; rows: Row[]; events: Benchmark['events'];
  fixture?: { revision: number; scenarioIndex: number; step: number; started: boolean; complete: boolean };
  consistency?: { ok: boolean; errors: string[] };
  summary?: { status: 'running' | 'succeeded' | 'incomplete' | 'failed' | 'error'; executed: number; succeeded: number; total: number; elapsedMs: number; misclicks: number; invalidSubmissions: number; meanScore: number };
};
/** Reconcile recorded outcomes with accepted fixture events; never invent missing results. */
export function consistencyErrors(result: Report): string[] {
  const errors: string[] = [];
  if (result.fixture && result.fixture.scenarioIndex !== result.rows.length) errors.push('Fixture scenario index differs from stored row count');
  if (result.fixture?.complete && result.rows.length !== result.suite.scenarios.length) errors.push('Fixture completion signal has missing scenario records');
  result.suite.scenarios.forEach((scenario, i) => {
    const row = result.rows[i];
    const events = result.events.filter(e => e.scenario === scenario.id);
    const steps = events.filter(e => e.outcome === 'step-success');
    const problem = (message: string) => errors.push(`${scenario.id}: ${message}`);
    if (!row) { if (steps.length === scenario.steps.length) problem('fixture completed but stored result is missing'); return; }
    if (row.id !== scenario.id) problem('stored scenario order/identity mismatch');
    if (row.completedSteps !== steps.length || steps.some((e, n) => e.step !== n)) problem('completed steps differ from fixture signals');
    if ((row.status === 'success') !== (steps.length === scenario.steps.length)) problem('fixture completion and stored status disagree');
    if (row.misclicks !== events.filter(e => e.outcome === 'misclick').length || row.invalidSubmissions !== events.filter(e => e.outcome === 'invalid-submission').length) problem('stored error counts differ from fixture events');
    if (row.status === 'not-run' ? row.elapsedMs !== null || events.length > 0 : row.elapsedMs === null || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs > scenario.budgetMs || events.some(e => e.elapsedMs > row.elapsedMs!)) problem('stored timing/status differs from executed events');
    const expected = row.status === 'success' && row.elapsedMs !== null ? Math.round(100 * (0.7 + 0.2 * (1 - row.elapsedMs / scenario.budgetMs) + 0.1 / (1 + row.misclicks + row.invalidSubmissions))) : 0;
    if (row.score !== expected) problem(`stored score ${row.score} differs from expected ${expected}`);
  });
  if (result.rows.length > result.suite.scenarios.length) errors.push('Unexpected extra scenario records');
  return errors;
}
export function report(run: Benchmark, environment: string, baseline?: Report): Report {
  const result: Report = { version: 1, suiteHash: fingerprint(run.suite), suite: structuredClone(run.suite), environment, ...(run.stopReason ? { stopReason: run.stopReason } : {}),
    rows: run.rows.map((r, i) => ({ ...r, transition: `${baseline?.rows[i]?.status ?? (r.status === 'not-run' ? 'not-run' : 'running')} → ${r.status}` })), events: structuredClone(run.events),
    fixture: { revision: run.revision, scenarioIndex: run.index, step: run.step, started: run.started !== null, complete: !run.current } };
  const errors = consistencyErrors(result);
  result.consistency = { ok: errors.length === 0, errors };
  const succeeded = result.rows.filter(r => r.status === 'success').length;
  result.summary = { status: errors.length ? 'error' : run.current ? 'running' : succeeded === run.suite.scenarios.length ? 'succeeded' : result.rows.some(r => r.status === 'not-run' || r.status === 'aborted') ? 'incomplete' : 'failed',
    executed: result.rows.filter(r => r.elapsedMs !== null).length, succeeded, total: run.suite.scenarios.length,
    elapsedMs: result.rows.reduce((n, r) => n + (r.elapsedMs ?? 0), 0), misclicks: result.rows.reduce((n, r) => n + r.misclicks, 0), invalidSubmissions: result.rows.reduce((n, r) => n + r.invalidSubmissions, 0),
    meanScore: Number((result.rows.reduce((n, r) => n + r.score, 0) / run.suite.scenarios.length).toFixed(2)) };
  return result;
}
export function markdown(current: Report, baseline?: Report) {
  if (baseline && (baseline.version !== 1 || baseline.suiteHash !== current.suiteHash || JSON.stringify(baseline.suite) !== JSON.stringify(current.suite))) throw new Error('Incompatible baseline: suite or scoring version changed');
  if (baseline && (baseline.rows.length !== current.suite.scenarios.length || baseline.rows.some((r, i) => r.id !== current.suite.scenarios[i].id))) throw new Error('Incomplete or reordered baseline');
  if (baseline && consistencyErrors(baseline).length) throw new Error('Inconsistent baseline: ' + consistencyErrors(baseline).join('; '));
  const errors = consistencyErrors(current);
  const lines = ['# Browser benchmark', '', `Suite: ${current.suite.id} (${current.suiteHash})`, '', `Environment: ${current.environment.replace(/[\r\n]/g, ' ')}`, '', ...(baseline ? [`Baseline environment: ${baseline.environment.replace(/[\r\n]/g, ' ')}`, '', 'Deltas are current minus baseline: negative time/misclicks and positive score indicate improvement. Compare time only when both runs succeeded.', ''] : []), '| Scenario | Status | Time ms | Misclicks | Invalid submits | Score | Δ time ms | Δ misclicks | Δ score | Transition |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---|'];
  if (errors.length) lines.splice(2, 0, `Consistency error: ${errors.join('; ')}`, '');
  if (current.summary) lines.splice(2, 0, `Overall: ${current.summary.status}; succeeded ${current.summary.succeeded}/${current.summary.total}; executed ${current.summary.executed}/${current.summary.total}`, '');
  if (current.stopReason) lines.splice(6, 0, `Stopped: ${current.stopReason}`, '');
  current.rows.forEach((r, i) => { const b = baseline?.rows[i]; lines.push(`| ${r.id} | ${r.status} | ${r.elapsedMs ?? '—'} | ${r.misclicks} | ${r.invalidSubmissions} | ${r.score} | ${b?.status === 'success' && r.status === 'success' ? r.elapsedMs! - b.elapsedMs! : '—'} | ${b ? r.misclicks - b.misclicks : '—'} | ${b ? r.score - b.score : '—'} | ${b ? `${b.status} → ${r.status}` : r.transition ?? '—'} |`); });
  lines.push('', `Executed scenarios: ${current.rows.filter(r => r.elapsedMs !== null).length}/${current.suite.scenarios.length}`, `Mean score: ${current.rows.length ? (current.rows.reduce((n, r) => n + r.score, 0) / current.suite.scenarios.length).toFixed(2) : '—'}`, '', 'Misclick = click outside a fixture control or on a non-goal button in the current step. Field focus is allowed; an incorrect form submission is counted separately. Clicks outside the browser document are not observable. Timing starts at Start scenario and includes subsequent model/tool/permission waits. No model self-reported success is used.', '');
  return lines.join('\n');
}
