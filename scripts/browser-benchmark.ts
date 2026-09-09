import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { suiteSchema, type Report } from './browser-benchmark/core';
import { startBenchmarkServer } from '../src/main/benchmarks/server';

async function main() {
  const args = process.argv.slice(2);
  function option(name: string, fallback?: string) { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${name}`); return args[i + 1]; }
  for (let i = 0; i < args.length; i += 2) if (!['--suite', '--out', '--baseline', '--environment', '--port'].includes(args[i])) throw Error(`Unknown option ${args[i]}`);
  const suite = suiteSchema.parse(JSON.parse(await readFile(resolve(option('--suite', 'benchmarks/browser/golden.json')!), 'utf8')));
  const environment = option('--environment');
  if (!environment?.trim() || environment.length > 2000) throw Error('--environment is required: record revision, model, browser/version, viewport, display scale, OS, voice mode, grants and cold/warm state');
  const out = resolve(option('--out', `/tmp/dex-browser-${Date.now()}`)!);
  const baselinePath = option('--baseline');
  const baseline: Report | undefined = baselinePath ? JSON.parse(await readFile(resolve(baselinePath), 'utf8')) : undefined;
  const server = await startBenchmarkServer({ suite, environment, out, baseline, port: Number(option('--port', '0')), onComplete: async () => { console.log(`Benchmark complete. Reports: ${out}`); } });
  // The standalone CLI stays alive until the operator stops it.
  const keepAlive = setInterval(() => {}, 1000);
  console.log(`Ask Dex: Open ${server.url} and complete all ${suite.scenarios.length} browser benchmark scenarios using only screenshots and computer controls. Click Start scenario for each task, follow its instructions, and stop at Benchmark complete. Keep normal permission gates.\nReports: ${out}\nCtrl+C finalizes unfinished scenarios.`);
  process.once('SIGINT', () => { clearInterval(keepAlive); void server.close().then(() => console.log(`Finalized reports: ${out}`)).catch(error => { console.error(error); process.exitCode = 1; }); });
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
