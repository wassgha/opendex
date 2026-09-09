import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLatencyStore, createSpanObserver, latencyReport, readLatencySamples, sanitizeSamples, type Phase } from '../src/main/diagnostics/latency-summary';

test('fixed phase correlation isolates concurrent tools and repeat realtime responses', () => {
  const rows: [Phase, number][] = [];
  const emit = (p: Phase, ms: number) => { rows.push([p, ms]); };
  const a = createSpanObserver('desktop-agent', emit);
  const b = createSpanObserver('desktop-agent', emit);
  a('start', 0); b('start', 0);
  a('first-text', 1200); a('first-text', 1300);
  a('tool-call', 1200, { call: 'same', text: 'PRIVATE' });
  b('tool-call', 10, { call: 'same' });
  b('tool-result', 30, { call: 'same' });
  a('tool-error', 1500, { call: 'same' });
  const rt = createSpanObserver('realtime', emit);
  rt('response-created', 0); rt('first-audio', 100); rt('first-audio', 200);
  rt('response-created', 500); rt('response-done', 600); rt('first-audio', 700);
  rt('response-created', 1000); rt('first-audio', 1200);
  assert.deepEqual(rows, [['model-first-text', 1200], ['tool-round-trip', 20], ['tool-round-trip', 300], ['realtime-first-audio', 100], ['realtime-first-audio', 200]]);
});

test('bounded persistence reloads safely, omits content, reports a dominant phase and trend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dex-latency-test-'));
  try {
    const store = createLatencyStore(dir);
    for (let i = 0; i < 250; i++) store.add('model-first-text', 1000 + i);
    store.add('tool-round-trip', 100);
    store.add('model-first-text', NaN);
    store.add('model-first-text', -1);
    store.add('PRIVATE' as Phase, 2);
    await store.flush();
    const samples = readLatencySamples(dir);
    assert.equal(samples['model-first-text']?.length, 200);
    const report = latencyReport(samples);
    assert.equal(report.dominantPhase, 'model-first-text');
    assert.equal(report.phases[0].recentMeanChangeMs, 100);
    assert.equal(report.phases[0].p95Ms, 1239);
    assert.equal(createLatencyStore(dir).samples['tool-round-trip']?.[0], 100);
    const raw = await readFile(join(dir, 'latency-summary.json'), 'utf8');
    assert.equal(raw.includes('PRIVATE'), false);
    if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'latency-summary.json'))).mode & 0o777, 0o600);
    await writeFile(join(dir, 'latency-summary.json'), '{broken');
    assert.deepEqual(readLatencySamples(dir), {});
    await writeFile(join(dir, 'latency-summary.json'), JSON.stringify({version: 1, samples: { secret: 'PRIVATE', 'tool-round-trip': [1, 'PRIVATE', Infinity, -2] }}));
    assert.deepEqual(readLatencySamples(dir), { 'tool-round-trip': [1] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('empty, tied and invalid samples never invent attribution; disk failure is nonfatal', async () => {
  assert.equal(latencyReport({}).dominantPhase, null);
  assert.equal(latencyReport({ 'screen-capture': [200], 'speech-synthesis': [210] }).dominantPhase, null);
  assert.deepEqual(sanitizeSamples({ 'screen-capture': [NaN, Infinity, -1, 3_600_001] }), { 'screen-capture': [] });
  const dir = await mkdtemp(join(tmpdir(), 'dex-latency-error-'));
  try {
    const file = join(dir, 'file'); await writeFile(file, '');
    const store = createLatencyStore(file); store.add('screen-capture', 100);
    await assert.doesNotReject(store.flush());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
