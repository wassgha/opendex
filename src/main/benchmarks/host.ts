import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import golden from '../../../benchmarks/browser/golden.json';
import { suiteSchema, markdown, fingerprint, type Report } from './core';
import { startBenchmarkServer } from './server';

const suite = suiteSchema.parse(golden);
type Server = Awaited<ReturnType<typeof startBenchmarkServer>>;

/** One run per app, shared by realtime controls and the existing desktop worker. */
export class BenchmarkHost {
  private active?: Server;
  private starting?: Promise<unknown>;
  private expiry?: ReturnType<typeof setTimeout>;
  private baseline?: Report;
  private comparisonBaseline?: Report;
  private cancelWorker?: () => void;
  private deadline = 0;
  private limitReached = false;
  constructor(private directory: string, private maxRunMs = 5 * 60_000) {
    if (!Number.isFinite(maxRunMs) || maxRunMs <= 0) throw Error("Invalid benchmark time limit");
  }

  async start(environment: string) {
    if (this.starting) return this.starting;
    this.starting = this.begin(environment);
    try { return await this.starting; } finally { this.starting = undefined; }
  }
  private async begin(environment: string) {
    if (this.active?.run.current && !this.active.failure) return this.status();
    if (this.active) await this.active.close();
    clearTimeout(this.expiry);
    const baselineFile = join(this.directory, 'baseline.json');
    try {
      const saved = JSON.parse(await readFile(baselineFile, 'utf8')) as Report;
      if (saved.suiteHash !== fingerprint(suite)) throw Error('Saved benchmark baseline uses different scenarios. Use the developer CLI for a new suite baseline.');
      this.baseline = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.baseline = undefined;
    }
    const out = join(this.directory, randomUUID());
    this.comparisonBaseline = this.baseline;
    this.active = await startBenchmarkServer({ suite, environment, out, baseline: this.baseline,
      onComplete: async result => {
        // Aborted/partial work never establishes a baseline. Timeouts are real results.
        if (!this.baseline && result.consistency?.ok && result.rows.length === suite.scenarios.length && result.rows.every(r => r.status === 'success' || r.status === 'timeout')) {
          await mkdir(this.directory, { recursive: true, mode: 0o700 });
          const temp = baselineFile + '.tmp';
          await writeFile(temp, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
          await rename(temp, baselineFile);
          this.baseline = result;
        }
      },
    });
    this.limitReached = false;
    this.deadline = Date.now() + this.maxRunMs;
    // The bound worker must stop injecting input as well as closing the fixture.
    this.expiry = setTimeout(() => {
      if (!this.active?.run.current) return;
      this.limitReached = true;
      void this.stop().catch(() => {});
    }, this.maxRunMs);
    this.expiry.unref();
    return this.status();
  }
  async stop() {
    if (this.starting) await this.starting;
    clearTimeout(this.expiry);
    if (this.limitReached) this.active?.run.stop('Maximum benchmark time limit reached');
    this.cancelWorker?.();
    this.cancelWorker = undefined;
    await this.active?.close();
    return this.status();
  }
  ownsUrl(url: unknown) { return typeof url === 'string' && Boolean(this.active?.run.current) && !this.active?.failure && url === this.active?.url; }
  bindWorker(signal: AbortSignal, abortWorker?: () => void) {
    const server = this.active;
    if (!server?.run.current || server.failure) return;
    this.cancelWorker = abortWorker;
    const finish = async () => {
      signal.removeEventListener('abort', cancel);
      if (this.active === server) { clearTimeout(this.expiry); this.cancelWorker = undefined; }
      await server.close();
    };
    const cancel = () => { void finish().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    return { finish, milestone: () => {
      const row = server.run.rows.at(-1);
      return row ? `Verified benchmark result: ${row.id} ${row.status === "success" ? "passed" : `ended with status ${row.status}`}.` : undefined;
    }, progress: () => {
      const run = server.run;
      const successes = run.rows.filter(r => r.status === 'success').length;
      return `At the latest measurement, benchmark results: ${run.rows.length} of ${run.suite.scenarios.length} scenarios finished; ${successes} succeeded. ${run.events.length === 0 ? 'No fixture clicks have been recorded; no browser scenario completion is verified.' : run.current ? `Current scenario: ${run.current.id}; ${run.step} steps completed.` : 'Read benchmarkDex status for final scores.'}`;
    } };
  }
  status() {
    if (!this.active) return { status: 'not-started', next: 'Call benchmarkDex with action start only when the user requests a benchmark.' };
    const result = this.active.result();
    const status = this.active.failure || !result.consistency?.ok ? 'error' : this.active.run.current ? 'running' : 'finished';
    return {
      maxRunMs: this.maxRunMs, remainingMs: status === 'running' ? Math.max(0, this.deadline - Date.now()) : 0,
      stopReason: this.limitReached ? 'Benchmark maximum time limit reached; unfinished work was aborted.' : undefined,
      status, error: this.active.failure ?? (result.consistency?.ok ? undefined : `Benchmark consistency error: ${result.consistency?.errors.join('; ')}`), url: status === 'running' ? this.active.url : undefined,
      outcome: status === 'error' ? 'error' : result.summary?.status, consistency: result.consistency, metrics: result.summary,
      rows: result.rows, reportPath: join(this.active.out, 'report.md'),
      summary: markdown(result, this.comparisonBaseline),
      next: status === 'running'
        ? `Open ${this.active.url} and complete all ${suite.scenarios.length} scenarios using only screenshots and computer controls. Click Start scenario for each task and follow the page instructions until Benchmark complete. Keep normal Open and Computer permission gates. Never inspect source, use scripts/network APIs, or ask the user to operate the benchmark. Then call benchmarkDex with action status and report the measured results. On denial or inability to continue, call benchmarkDex with action stop and report the actual blocker. Starting the fixture is not completion.`
        : 'Report these measured results and comparison, including failures. Do not claim improvement from an incomplete run or treat one run as a reliable trend.',
    };
  }
}

let host: BenchmarkHost | undefined;
export async function benchmarkHost() {
  if (!host) { const { app } = await import('electron'); host = new BenchmarkHost(join(app.getPath('userData'), 'browser-benchmarks')); }
  return host;
}
export function isActiveBenchmarkUrl(url: unknown) { return host?.ownsUrl(url) ?? false; }
export function bindBenchmarkWorker(task: unknown, signal: AbortSignal, abortWorker?: () => void) {
  return typeof task === 'string' && /\bbenchmark\b/i.test(task) ? host?.bindWorker(signal, abortWorker) : undefined;
}
