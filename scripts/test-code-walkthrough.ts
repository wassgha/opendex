import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { CodeWalkthrough, WALKTHROUGH_ENTRIES } from '../src/skills/open/code-walkthrough';
import { openWalkthroughLocation } from '../src/skills/open/walkthrough-editor';
import { buildToolSet } from '../src/skills/registry';
import { buildRealtimeToolDefs } from '../src/main/agent/realtime/realtime-tools';
import { DEFAULT_CONFIG, mergeConfig } from '../src/main/config/schema';

test('real checkout: start, list, question jumps, symbols, next and end across turns', async () => {
  const calls: [string, number][] = [];
  const tour = new CodeWalkthrough({ packaged: false, appPath: process.cwd(), navigate: async (file, line) => { calls.push([file, line]); return 'test editor'; } });
  assert.match((await tour.run({ action: 'jump', target: 'tools' })).error!, /Start/);
  const start = await tour.run({ action: 'start' });
  assert.equal(start.current, 'overview');
  assert.ok('components' in start);
  assert.match(start.summary!, /preload bridge/);
  assert.ok(start.components!.some(c => c.name.includes('Skills')));
  assert.ok('flow' in start);
  assert.match(start.flow!, /renderer.*preload IPC.*main/);
  assert.ok(!('sourceExcerpt' in start));
  assert.ok(!('file' in start));
  assert.equal(calls.length, 0);
  assert.equal(start.entries?.length, 8);
  assert.equal((await tour.run({ action: 'list' })).entries?.length, 8);
  assert.equal((await tour.run({ action: 'list' })).current, 'overview');
  assert.equal(calls.length, 0);
  const command = await tour.run({ action: 'next' });
  assert.equal(command.current, 'command');
  assert.ok('sourceExcerpt' in command);
  assert.match(command.sourceExcerpt!, /ipcMain.on\(IPC.chatStart/);
  assert.equal((await tour.run({ action: 'next' })).current, 'tools');
  assert.equal((await tour.run({ action: 'next' })).current, 'agent');
  assert.equal((await tour.run({ action: 'jump', target: 'tools' })).current, 'tools');
  const symbol = await tour.run({ action: 'jump', target: 'buildToolSet' });
  assert.ok('sourceExcerpt' in symbol);
  assert.match(symbol.sourceExcerpt!, /export function buildToolSet/);
  assert.equal((await tour.run({ action: 'next' })).current, 'agent');
  assert.equal((await tour.run({ action: 'jump', target: 'src/preload/index.ts' })).current, 'bridge');
  const count = calls.length;
  assert.match((await tour.run({ action: 'jump', target: '../../secrets.json' })).error!, /not in/);
  assert.equal(calls.length, count);
  assert.equal((await tour.run({ action: 'end' })).active, false);
  assert.match((await tour.run({ action: 'next' })).error!, /Start/);
});

test('missing editor, packaged source, abort and end never fabricate success', async () => {
  const deps = { packaged: false, appPath: process.cwd(), navigate: async () => null };
  const tour = new CodeWalkthrough(deps);
  assert.equal((await tour.run({ action: 'start' })).current, 'overview');
  assert.match((await tour.run({ action: 'next' })).error!, /No supported editor/);
  assert.equal((await tour.run({ action: 'list' })).current, 'overview');
  assert.match((await new CodeWalkthrough({ ...deps, packaged: true }).run({ action: 'start' })).error!, /development checkout/);
  let navigated = false;
  const cancelled = new CodeWalkthrough({ ...deps, navigate: async () => { navigated = true; return 'editor'; } });
  await cancelled.run({ action: 'start' }, AbortSignal.abort());
  assert.equal(navigated, false);
  const pending = cancelled.run({ action: 'start' });
  await cancelled.run({ action: 'end' });
  assert.match((await pending).error!, /superseded/);
  assert.equal(navigated, false);
});

test('source boundary rejects symlinks outside checkout and oversized modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dex-tour-'));
  const outside = await mkdtemp(join(tmpdir(), 'dex-tour-out-'));
  try {
    await writeFile(join(root, 'package.json'), '{"name":"opendex"}');
    for (const entry of WALKTHROUGH_ENTRIES) {
      await mkdir(dirname(join(root, entry.file)), { recursive: true });
      await writeFile(join(root, entry.file), entry.anchor);
    }
    const file = join(root, WALKTHROUGH_ENTRIES[0].file);
    await rm(file);
    await writeFile(join(outside, 'secret.ts'), 'private');
    await symlink(join(outside, 'secret.ts'), file);
    const tour = new CodeWalkthrough({ packaged: false, appPath: root, navigate: async () => { throw new Error('must not launch'); } });
    assert.match((await tour.run({ action: 'start' })).error!, /outside/);
    await rm(file);
    await writeFile(file, 'x'.repeat(512 * 1024 + 1));
    assert.match((await tour.run({ action: 'start' })).error!, /read limit/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('editor uses literal goto arguments, skips missing CLI and reports unsupported platforms', async () => {
  const calls: [string, string[]][] = [];
  const file = '/tmp/a b;$(literal).ts';
  const result = await openWalkthroughLocation(file, 42, 'linux', async (command, args) => {
    calls.push([command, args]);
    if (command === 'code') throw new Error('missing');
  });
  assert.equal(result, 'cursor');
  assert.deepEqual(calls[1], ['cursor', ['--reuse-window', '--goto', `${file}:42:1`]]);
  assert.equal(await openWalkthroughLocation(file, 1, 'win32'), null);
});

test('walkthrough uses the Open gate and is directly available to realtime', async () => {
  let requested = '';
  const tools = buildToolSet({ config: DEFAULT_CONFIG, requestPermission: async id => { requested = id; return false; } });
  assert.deepEqual(await tools.codeWalkthrough.execute!({ action: 'start' }, { toolCallId: 'test', messages: [] }), { error: 'Permission denied by the user.' });
  assert.equal(requested, 'open');
  assert.ok(buildRealtimeToolDefs(DEFAULT_CONFIG).some(t => t.name === 'codeWalkthrough'));
  const disabled = mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { open: false } } });
  assert.equal(buildToolSet({ config: disabled, requestPermission: async () => true }).codeWalkthrough, undefined);
  assert.ok(!buildRealtimeToolDefs(disabled).some(t => t.name === 'codeWalkthrough'));
});


test('overview permits direct jumps, restart resets position and end works before detail', async () => {
  let navigations = 0;
  const tour = new CodeWalkthrough({ packaged: false, appPath: process.cwd(), navigate: async () => { navigations++; return 'editor'; } });
  for (const target of ['command', 'tools', 'agent']) {
    const before = navigations;
    assert.equal((await tour.run({ action: 'start' })).current, 'overview');
    assert.equal(navigations, before);
    assert.equal((await tour.run({ action: 'jump', target })).current, target);
    assert.equal(navigations, before + 1);
  }
  await tour.run({ action: 'start' });
  assert.equal((await tour.run({ action: 'next' })).current, 'command');
  await tour.run({ action: 'start' });
  assert.equal((await tour.run({ action: 'end' })).active, false);
  assert.match((await tour.run({ action: 'next' })).error!, /Start/);
});

test('visual surface opens at overview, follows code navigation and closes on end', async () => {
  const frames: import('../src/skills/open/walkthrough-document').WalkthroughView[] = [];
  const focus: boolean[] = [];
  let closed = 0;
  const tour = new CodeWalkthrough({ packaged: false, appPath: process.cwd(), navigate: async () => 'test editor',
    present: async (view, foreground) => { frames.push(view); focus.push(foreground); }, dismiss: () => { closed++; },
  });
  await tour.run({ action: 'start' });
  assert.equal(frames[0].current, 'overview');
  assert.equal(frames[0].sourceExcerpt, undefined);
  await tour.run({ action: 'next' });
  assert.equal(frames[1].current, 'command');
  assert.match(frames[1].sourceExcerpt!, /ipcMain.on/);
  await tour.run({ action: 'jump', target: 'tools' });
  assert.equal(frames[2].current, 'tools');
  assert.deepEqual(focus, [true, false, false]);
  await tour.run({ action: 'end' });
  assert.equal(closed, 1);
});

test('visual document escapes source, exposes accessible controls and blocks unrelated commands', async () => {
  const { walkthroughDocument } = await import('../src/skills/open/walkthrough-document');
  const { walkthroughAction } = await import('../src/skills/open/walkthrough-window');
  const html = walkthroughDocument({ current: 'tools', title: '<script>bad()</script>', summary: 'a & b', entries: [...WALKTHROUGH_ENTRIES], sourceExcerpt: '<img src=x onerror=bad()>', file: 'test.ts', line: 4 });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /aria-labelledby="map-title map-desc"/);
  assert.match(html, /End walkthrough/);
  assert.match(html, /Next stop/);
  assert.deepEqual(walkthroughAction('https://dex-walkthrough.invalid/?action=jump&target=tools'), { action: 'jump', target: 'tools' });
  for (const url of ['https://other.invalid/?action=end', 'javascript:bad()', 'https://dex-walkthrough.invalid/?action=delete', 'https://dex-walkthrough.invalid/?action=jump']) assert.equal(walkthroughAction(url), null);
});
