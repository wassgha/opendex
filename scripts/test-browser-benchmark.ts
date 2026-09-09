import { test } from 'node:test';
import assert from 'node:assert/strict';
import golden from '../benchmarks/browser/golden.json';
import { Benchmark, suiteSchema, fingerprint, report, markdown, consistencyErrors } from './browser-benchmark/core';
import { page } from './browser-benchmark/page';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { BenchmarkHost } from '../src/main/benchmarks/host';
import { benchmarkBlocker } from '../src/skills/benchmark/skill';
import { DEFAULT_CONFIG } from '../src/main/config/schema';
import { cancelPendingTools } from '../src/renderer/src/lib/dex/cancelled-tools';
import { taskProgress } from '../src/renderer/src/lib/task-progress';
import { diagnosticToolOutcome, toolFailureCode } from '../src/main/diagnostics/tool-outcome';

const suite = suiteSchema.parse(golden);
function complete(run: Benchmark) {
  while (run.current) {
    run.start();
    while (run.started !== null) {
      const { target, values } = run.current.steps[run.step].success;
      run.click({ target, values, revision: run.revision, x: 100, y: 200 });
    }
  }
}
test('golden criteria drive completion independently of claims; metrics and exact replay are deterministic', () => {
  let now = 0;
  const run = new Benchmark(suite, () => now);
  run.start();
  const click = (target: string, values = {}) => run.click({ revision: run.revision, target, values, x: 10, y: 20 });
  click('offers'); click(''); click('query'); click('search', { query: 'wrong' });
  assert.equal(run.step, 0);
  now = 1000; click('search', { query: 'lantern', unrelated: 'do not retain' });
  assert.equal(run.step, 1);
  now = 2000; click('amber');
  assert.deepEqual(run.rows[0], { id: 'catalog-search', status: 'success', elapsedMs: 2000, misclicks: 2, invalidSubmissions: 1, score: 92, completedSteps: 2 });
  complete(run);
  assert.equal(run.rows.length, 3);
  assert.ok(run.rows.every(r => r.status === 'success'));
  assert.ok(!JSON.stringify(run.events).includes('do not retain'));
  const replay = new Benchmark(suite, () => now);
  let scenario = '';
  for (const e of run.events) {
    if (scenario !== e.scenario) { now = 0; replay.start(); scenario = e.scenario; }
    now = e.elapsedMs;
    replay.click(e);
  }
  assert.equal(JSON.stringify(report(replay, 'fixture')), JSON.stringify(report(run, 'fixture')));
  assert.equal(markdown(report(run, 'fixture')), markdown(report(replay, 'fixture')));
});
test('timeouts, cancellation, duplicate starts and stale clicks cannot produce success', () => {
  let now = 0;
  const run = new Benchmark(suite, () => now);
  run.start(); now = 500; run.start(); assert.equal(run.started, 0);
  run.click({ revision: 0, target: 'search', values: { query: 'lantern' }, x: 0, y: 0 });
  assert.equal(run.events.length, 0);
  now = suite.scenarios[0].budgetMs; run.tick();
  assert.equal(run.rows[0].status, 'timeout'); assert.equal(run.rows[0].score, 0);
  assert.equal(run.rows[0].elapsedMs, now);
  run.start(); run.stop();
  assert.deepEqual(run.rows.map(r => r.status), ['timeout', 'aborted', 'not-run']);
  assert.equal(run.rows[2].elapsedMs, null);
});
test('comparison shows regression and recovery; changed definitions and incomplete baselines are rejected', () => {
  const fast = new Benchmark(suite, () => 0); complete(fast);
  const slow = new Benchmark(suite, () => 0); slow.start(); slow.finish('timeout'); complete(slow);
  const a = report(fast, 'fast'), b = report(slow, 'slow');
  assert.match(markdown(b, a), /success → timeout/);
  assert.match(markdown(a, b), /timeout → success/);
  assert.match(markdown(a, a), /\| 0 \| 0 \| 0 \| success → success/);
  const changed = structuredClone(suite); changed.scenarios[0].budgetMs++;
  assert.notEqual(fingerprint(changed), fingerprint(suite));
  assert.throws(() => markdown(a, { ...b, suiteHash: fingerprint(changed) }), /Incompatible/);
  assert.throws(() => markdown(a, { ...b, rows: [] }), /Incomplete/);
});
test('suite validation rejects broken or ambiguous criteria and fixture escapes task text', () => {
  const broken = structuredClone(golden); broken.scenarios[0].steps[0].success.target = 'missing';
  assert.equal(suiteSchema.safeParse(broken).success, false);
  const duplicate = structuredClone(golden); duplicate.scenarios[1].id = duplicate.scenarios[0].id;
  assert.equal(suiteSchema.safeParse(duplicate).success, false);
  const custom = structuredClone(suite); custom.scenarios[0].task = '<script>alert(1)</script>';
  const run = new Benchmark(custom);
  assert.match(page(run, 'nonce'), /&lt;script&gt;/);
  assert.ok(!page(run, 'nonce').includes('"success":'));
});

test('real CLI serves isolated fixtures, writes baseline/comparison, and finalizes cancellation', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dex-benchmark-test-'));
  async function launch(name: string, baseline?: string) {
    const out = join(dir, name);
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/browser-benchmark.ts', '--out', out, '--environment', 'synthetic protocol test; not a Dex run', ...(baseline ? ['--baseline', baseline] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', b => { stderr += b; });
    const url = await new Promise<string>((ok, fail) => {
      let stdout = '';
      child.on('error', fail);
      child.once('exit', code => fail(Error(`CLI exited ${code}: ${stderr}`)));
      child.stdout.on('data', b => { stdout += b; const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+/); if (match) ok(match[0]); });
    });
    const origin = new URL(url).origin;
    const post = async (path: string, body: unknown) => {
      const r = await fetch(url + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(r.status, 200); return r.json() as Promise<{ revision: number }>;
    };
    const stop = async () => { const exited = once(child, 'exit'); child.kill('SIGINT'); await exited; assert.equal(child.exitCode, 0, stderr); };
    return { out, url, origin, post, stop };
  }
  try {
    const first = await launch('baseline');
    try {
      const html = await fetch(first.url);
      assert.match(await html.text(), /Start scenario/);
      assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
      assert.equal((await fetch(first.url + '/start', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
      assert.equal((await fetch(first.origin + '/guess')).status, 403);
      for (const s of suite.scenarios) {
        let state = await first.post('/start', {});
        for (const p of s.steps) state = await first.post('/click', { revision: state.revision, ...p.success, x: 25, y: 50 });
      }
      assert.match(await (await fetch(first.url)).text(), /Benchmark complete/);
    } finally { await first.stop(); }
    const baseline = JSON.parse(await readFile(join(first.out, 'report.json'), 'utf8'));
    assert.deepEqual(baseline.rows.map((r: { status: string }) => r.status), ['success', 'success', 'success']);
    const second = await launch('candidate', join(first.out, 'report.json'));
    try { await second.post('/start', {}); } finally { await second.stop(); }
    const comparison = await readFile(join(second.out, 'report.md'), 'utf8');
    assert.match(comparison, /success → aborted/);
    assert.match(comparison, /success → not-run/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('in-app host is singleton per run, persists its baseline, compares later runs and finalizes stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dex-benchmark-host-'));
  const host = new BenchmarkHost(dir);
  const post = async (url: string, path: string, body: unknown) => {
    const response = await fetch(url + path, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json() as Promise<{ revision: number }>;
  };
  try {
    const results = await Promise.all([host.start('fixture'), host.start('fixture')]) as Array<{ url: string }>;
    assert.equal(results[0].url, results[1].url);
    const url = results[0].url;
    const worker = host.bindWorker(new AbortController().signal)!;
    assert.equal(worker.milestone(), undefined);
    for (const s of suite.scenarios) {
      let state = await post(url, '/start', {});
      for (const p of s.steps) state = await post(url, '/click', { revision: state.revision, ...p.success, x: 0, y: 0 });
      assert.equal(worker.milestone(), `Verified benchmark result: ${s.id} passed.`);
      assert.doesNotMatch(worker.milestone()!, /current|still running|steps completed/);
    }
    const beforeClose = host.status();
    assert.equal(beforeClose.outcome, 'succeeded');
    const savedBeforeClose = JSON.parse(await readFile(beforeClose.reportPath!.replace('report.md', 'report.json'), 'utf8'));
    assert.deepEqual(savedBeforeClose.rows, beforeClose.rows);
    assert.deepEqual(savedBeforeClose.summary, beforeClose.metrics);
    assert.equal(savedBeforeClose.consistency.ok, true);
    assert.equal(savedBeforeClose.fixture.complete, true);
    assert.equal(savedBeforeClose.summary.succeeded, 3);
    assert.ok(savedBeforeClose.rows.every((r: {elapsedMs: number; score: number; transition: string}) => Number.isFinite(r.elapsedMs) && r.score > 0 && r.transition === 'running → success'));
    await worker.finish();
    await host.stop();
    assert.equal(host.status().outcome, 'succeeded');
    assert.equal(host.status().status, 'finished');
    assert.ok(!host.status().summary?.includes('Baseline environment'));
    const baseline = JSON.parse(await readFile(join(dir, 'baseline.json'), 'utf8'));
    assert.equal(baseline.rows.length, 3);
    const resumed = new BenchmarkHost(dir);
    try {
      const next = await resumed.start('candidate') as { url: string };
      await post(next.url, '/start', {});
      const stopped = await resumed.stop();
      assert.match(stopped.summary!, /success → aborted/);
      assert.equal(await readFile(join(dir, 'baseline.json'), 'utf8'), JSON.stringify(baseline, null, 2) + '\n');
    } finally { await resumed.stop(); }
  } finally { await host.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('benchmark startup reports disabled or never-granted prerequisites without enabling them', () => {
  const context = { config: structuredClone(DEFAULT_CONFIG), platform: process.platform, availableSkillIds: ['open'] };
  const before = JSON.stringify(context);
  assert.match(benchmarkBlocker(context)!, /computer/);
  assert.equal(JSON.stringify(context), before);
  assert.equal(benchmarkBlocker({ ...context, availableSkillIds: ['open', 'computer'] }), undefined);
  assert.match(benchmarkBlocker()!, /unavailable/);
});

test('worker cancellation finalizes the fixture and leaves truthful progress without a baseline', async () => {
 const dir=await mkdtemp(join(tmpdir(),'dex-benchmark-cancel-'));
 const host=new BenchmarkHost(dir);
 try {
  await host.start('fixture');
  const controller=new AbortController(); const worker=host.bindWorker(controller.signal)!;
  assert.equal(worker.milestone(),undefined);
  assert.match(worker.progress(),/0 of 3/); assert.match(worker.progress(),/No fixture clicks/);
  controller.abort(); await worker.finish();
  assert.equal(host.status().status,'finished');
  assert.deepEqual(host.status().rows?.map(r=>r.status),['not-run','not-run','not-run']);
  await assert.rejects(readFile(join(dir,'baseline.json')),{code:'ENOENT'});
 } finally {await host.stop();await rm(dir,{recursive:true,force:true});}
});
test('cancelled worker cards stop showing an active click and preserve completed history',()=>{
 const tools=[{id:'task',name:'run_task',input:{},result:null,status:'running' as const},{id:'click',name:'click',input:{},result:null,status:'running' as const},{id:'done',name:'captureScreen',input:{},result:{ok:true},status:'done' as const}];
 assert.equal(taskProgress('speaking',tools)?.label,'Clicking a control');
 const cancelled=cancelPendingTools(tools,new Set(['task','click']));
 assert.equal(taskProgress('speaking',cancelled),null);
 assert.equal(cancelled[2],tools[2]);
 assert.equal(cancelled[1].status,'error');
});
test('diagnostics preserve safe failure/cancellation categories without raw output',()=>{
 assert.equal(toolFailureCode(new Error('The foreground window changed or moved since the screenshot.')), 'stale-desktop-frame');
 assert.deepEqual(diagnosticToolOutcome({error:'private page text',code:'browser-research-navigation'}),{failed:true,reason:'browser-research-navigation'});
 assert.deepEqual(diagnosticToolOutcome({error:'private',reason:'private'}),{failed:true});
 assert.equal(diagnosticToolOutcome({state:'cancelled',reason:'accepted spoken input interrupted the active task'}).reason,'accepted spoken input interrupted the active task');
});

test('hard run deadline aborts the actual worker, persists reason, and cannot establish a partial baseline', async () => {
 const dir=await mkdtemp(join(tmpdir(),'dex-benchmark-deadline-'));
 const host=new BenchmarkHost(dir,80);
 try {
  await host.start('deadline test');
  const controller=new AbortController();
  const worker=host.bindWorker(controller.signal,()=>controller.abort())!;
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(controller.signal.aborted,true);
  await worker.finish();
  assert.match(host.status().stopReason!,/maximum time/i);
  const saved=JSON.parse(await readFile(host.status().reportPath!.replace('report.md','report.json'),'utf8'));
  assert.match(saved.stopReason,/time limit/);
  assert.equal(saved.rows.every((r: {status: string})=>r.status==='not-run'),true);
  await assert.rejects(readFile(join(dir,'baseline.json')),{code:'ENOENT'});
 } finally {await host.stop();await rm(dir,{recursive:true,force:true});}
});

import { controlTargets } from '../src/skills/computer/control-targets';
test('native control centers use the latest zoom/display scale and reject off-image or malformed targets',()=>{
 const shot={width:200,height:100,offsetX:-100,offsetY:200,scaleX:0.5,scaleY:0.5};
 const target={role:'AXButton',label:'Search',x:-80,y:210,width:20,height:10};
 assert.match(controlTargets([target],shot),/Search.*\(60, 30\)/);
 assert.equal(controlTargets([{...target,x:500},{...target,width:NaN}],shot),'');
 assert.match(page(new Benchmark(suite),'test'),/isTrusted/);
 const run=new Benchmark(suite);run.start();
 assert.match(page(run,'test'),/<label data-target="query">/);
});


test('report snapshots remain immutable and mismatches surface instead of becoming not-run', () => {
  let now = 0;
  const run = new Benchmark(suite, () => now);
  const initial = report(run, 'synthetic');
  run.start(); now = 2000; complete(run);
  const good = report(run, 'synthetic');
  assert.equal(initial.rows.length, 0);
  assert.equal(initial.events.length, 0);
  assert.equal(good.summary?.status, 'succeeded');
  assert.deepEqual(consistencyErrors(good), []);
  run.rows[0].status = 'not-run';
  run.rows[0].elapsedMs = null;
  const bad = report(run, 'synthetic');
  assert.equal(good.rows[0].status, 'success');
  assert.equal(bad.summary?.status, 'error');
  assert.match(markdown(bad), /Consistency error:.*catalog-search/);
  assert.match(bad.consistency!.errors.join(';'), /completion and stored status disagree/);
  run.rows.length = 0;
  assert.match(report(run, 'synthetic').consistency!.errors.join(';'), /missing scenario records/);
});

test('metrics reconcile against fixture evidence and incomplete summaries count only executed scenarios', () => {
  const run = new Benchmark(suite, () => 1000); complete(run);
  for (const field of ['misclicks', 'invalidSubmissions', 'score', 'completedSteps'] as const) {
    const changed = report(run, 'synthetic'); changed.rows[0][field]++;
    assert.ok(consistencyErrors(changed).length, field);
  }
  const stopped = new Benchmark(suite); stopped.start(); stopped.stop();
  const result = report(stopped, 'synthetic');
  assert.equal(result.summary?.status, 'incomplete');
  assert.equal(result.summary?.executed, 1);
  assert.match(markdown(result), /Executed scenarios: 1\/3/);
  assert.match(page(stopped, 'test'), /Benchmark ended/);
  assert.doesNotMatch(page(stopped, 'test'), /All results have been captured/);
});

import { startBenchmarkServer } from '../src/main/benchmarks/server';
test('inconsistent fixture records persist diagnostic evidence and fail explicitly without baseline promotion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dex-benchmark-mismatch-'));
  let promoted = false;
  const server = await startBenchmarkServer({ suite, environment: 'synthetic mismatch', out: dir, onComplete: async () => { promoted = true; } });
  try {
    complete(server.run);
    server.run.rows[0].status = 'not-run';
    await assert.rejects(server.close(), /Benchmark consistency error.*catalog-search/);
    assert.match(server.failure!, /consistency error/);
    const saved = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    assert.equal(saved.summary.status, 'error');
    assert.equal(saved.fixture.complete, true);
    assert.ok(saved.events.length > 0);
    assert.equal(promoted, false);
  } finally { await server.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
});

test('failed persistence preserves the previous valid JSON and surfaces a recording error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dex-benchmark-write-failure-'));
  const server = await startBenchmarkServer({ suite, environment: 'synthetic write failure', out: dir });
  try {
    const original = await readFile(join(dir, 'report.json'), 'utf8');
    await mkdir(join(dir, 'report.json.tmp'));
    const response = await fetch(server.url + '/start', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 500);
    assert.match(await response.text(), /Benchmark recording failed/);
    assert.ok(server.failure);
    assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), original);
  } finally { await server.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
});
