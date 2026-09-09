import { controlTargets } from "../src/skills/computer/control-targets";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DesktopExecution } from '../src/skills/computer/execution';
import { TOOLS, meta } from '../src/skills/computer/meta';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, unknown>) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: (id: string) => id in mocks ? mocks[id] : require(id), process, console, Buffer, AbortController, setTimeout, clearTimeout, performance });
  return exports as any;
}

test('switching workers invalidates stale coordinate frames; cancelled queued actions never run', async () => {
  const execution = new DesktopExecution<string>();
  const a = {}, b = {}, abort = new AbortController();
  await execution.run(a, abort.signal, async () => { execution.state().shot = 'zoom'; });
  await execution.run(b, undefined, async () => { assert.equal(execution.state().shot, null); execution.state().shot = 'full'; });
  await execution.run(a, abort.signal, async () => assert.equal(execution.state().shot, null, 'another worker may have changed the desktop'));
  let release!: () => void;
  const active = execution.run(b, undefined, () => new Promise<void>(r => { release = r; }));
  await new Promise(r => setImmediate(r));
  let clicks = 0;
  const queued = execution.run(a, abort.signal, async () => { clicks++; });
  abort.abort(); release(); await active;
  await assert.rejects(queued, /abort/i); assert.equal(clicks, 0);
});

function computerFixture() {
  const captures: any[] = [];
  const actions: string[] = []; let focus = 'Selected task', move: (() => void) | undefined;
  const shot = (width = 1280) => ({ width, height: 800, displayId: 1, offsetX: 100, offsetY: 20, scaleX: 2, scaleY: 2, base64: 'fixture', mediaType: 'image/jpeg', signature: new Uint8Array(1024) });
  const mod = load('../src/skills/computer/skill.ts', {
    './execution': { DesktopExecution }, './meta': { TOOLS, meta }, './control-targets': { controlTargets }, './window-control': { macAppControls: () => ({ visibleControls: () => JSON.stringify([{role:'AXButton',label:'Search',x:120,y:40,width:40,height:20}]) }) },
    '../../main/config/store': { getConfig: () => ({ computer: { animateCursor: true } }) },
    './screen-capture': { captureScreen: async () => shot(640), captureStable: async (options: any) => { captures.push(options); return shot(); },
      toScreenPoint: (x: number, y: number, s: any) => ({ x: s.offsetX + x * s.scaleX, y: s.offsetY + y * s.scaleY }) },
    electron: { clipboard: {}, systemPreferences: { isTrustedAccessibilityClient: () => true } },
    '@nut-tree-fork/nut-js': { Button: { LEFT: 1 }, Key: {}, Point: class { constructor(public x: number, public y: number) {} },
      straightTo: (p: any) => p, keyboard: { config: {} },
      mouse: { config: {}, move: async (p: any) => { actions.push(`move:${p.x},${p.y}`); move?.(); }, click: async () => actions.push('click') },
      getActiveWindow: async () => ({ title: focus, region: { left: 0, top: 0, width: 1000, height: 800 } }) },
  });
  const invoke = (name: string, input: any, ctx: any) => mod.computerSkill.tools.find((t: any) => t.name === name).execute(input, ctx);
  return { invoke, actions, captures, setFocus: (v: string) => { focus = v; }, onMove: (v: () => void) => { move = v; } };
}

test('actual click tool rejects ungrounded/outside points and changed windows; tiny-change frames are returned with dimensions', async () => {
  const f = computerFixture(), ctx = {};
  await assert.rejects(f.invoke(TOOLS.click, { x: 1, y: 1 }, ctx), /screenshot/);
  await f.invoke(TOOLS.captureScreen, {}, ctx);
  await assert.rejects(f.invoke(TOOLS.click, { x: 1400, y: 1 }, ctx), /Coordinates/);
  assert.equal(f.actions.length, 0);
  const result = await f.invoke(TOOLS.click, { x: 20, y: 30 }, ctx);
  assert.deepEqual(f.actions, ['move:140,80', 'click']);
  assert.ok(result.shot, 'even an identical coarse signature must return the actual action frame');
  assert.match(result.message, /1280×800/);
  if (process.platform === "darwin") assert.match(result.message, /Search.*\(20, 15\)/);
  f.setFocus('Different task');
  await assert.rejects(f.invoke(TOOLS.click, { x: 20, y: 30 }, ctx), /foreground window changed/);
  assert.equal(f.actions.filter(a => a === 'click').length, 1);
});

test('stop during cursor movement prevents the actual mouse click', async () => {
  const f = computerFixture(), abort = new AbortController(), ctx = { signal: abort.signal };
  await f.invoke(TOOLS.captureScreen, {}, ctx);
  f.onMove(() => abort.abort());
  await assert.rejects(f.invoke(TOOLS.click, { x: 20, y: 30 }, ctx), /abort/i);
  assert.equal(f.actions.includes('click'), false);
});

test('cancellation dismisses a live permission prompt and cannot later grant execution', async () => {
  const dismissed: string[] = []; let prompt: any;
  const mod = load('../src/main/agent/permissions.ts', { '../config/store': { getConfig: () => ({ skills: { permissions: {} } }), updateConfig: () => {} } });
  mod.setPermissionUi({ present: (p: any) => { prompt = p; }, dismiss: (id: string) => dismissed.push(id) });
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const abort = new AbortController();
  const result = mod.makePermissionRequester(sender, abort.signal)('computer', 'Computer', 'Click');
  abort.abort();
  assert.equal(await result, false);
  assert.deepEqual(dismissed, [prompt.id]);
  assert.equal(mod.pendingPermissions(), 0);
  mod.resolvePermission(prompt.id, 'always');
  assert.equal(sender.listenerCount('destroyed'), 0);
});

test('small menu changes affect settling; screen capture rejects wrong displays and maps Retina zoom coordinates', async () => {
  class Image {
    constructor(public width: number, public height: number) {}
    isEmpty() { return false; }
    getSize() { return { width: this.width, height: this.height }; }
    resize(size: { width: number; height?: number }) { return new Image(size.width, size.height ?? Math.round(this.height * size.width / this.width)); }
    crop(rect: { width: number; height: number }) { return new Image(rect.width, rect.height); }
    toBitmap() { return Buffer.alloc(this.width * this.height * 4); }
    toJPEG() { return Buffer.from('fixture'); }
  }
  const display = { id: 9, scaleFactor: 2, size: { width: 1440, height: 900 }, bounds: { x: -1440, y: 0, width: 1440, height: 900 } };
  let source = '9';
  const mod = load('../src/skills/computer/screen-capture.ts', {
    '../../main/agent/latency': { latencySpan: () => ({ mark: () => {} }) },
    electron: { systemPreferences: { getMediaAccessStatus: () => 'granted' },
      desktopCapturer: { getSources: async () => [{ display_id: source, thumbnail: new Image(2880, 1800) }] },
      screen: { getAllDisplays: () => [display], getCursorScreenPoint: () => ({ x: -200, y: 100 }), getDisplayNearestPoint: () => display } },
  });
  const a = new Uint8Array(128 * 128), b = new Uint8Array(a);
  b.fill(120, 0, 25);
  assert.equal(mod.framesDiffer(a, b), true, 'a small menu is not swallowed by screen-wide averaging');
  const full = await mod.captureScreen();
  assert.equal(full.displayId, 9);
  assert.equal(full.width, 1280);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.toScreenPoint(640, 400, full))), { x: -720, y: 450 });
  const zoom = await mod.captureScreen({ regionRef: full, region: { x: 100, y: 100, w: 200, h: 200 } });
  assert.equal(zoom.width, 450);
  assert.equal(zoom.scaleX, 0.5);
  assert.equal(zoom.offsetX, -1327.5);
  assert.match((await mod.captureScreen({ displayId: 10 })).error, /no longer available/);
  source = 'wrong';
  assert.match((await mod.captureScreen()).error, /No screen source/);
});


test('initial capture cannot request a fabricated crop; zoom requires its own reference', async () => {
  const f = computerFixture(), ctx = {};
  const blocked = await f.invoke(TOOLS.zoomScreen, { region: { x: 0, y: 0, w: 100, h: 100 } }, ctx);
  assert.match(blocked.error, /captureScreen with no arguments/);
  assert.equal(f.captures.length, 0);
  // Extra model fields cannot influence this parameterless tool, even if an
  // external caller bypasses the schema parser.
  const full = await f.invoke(TOOLS.captureScreen, { displayId: 0, region: { x: 0, y: 0, w: 0, h: 0 } }, ctx);
  assert.equal(full.ok, true);
  assert.equal(f.captures[0].region, undefined);
  assert.equal(f.captures[0].displayId, undefined);
  await f.invoke(TOOLS.zoomScreen, { region: { x: 10, y: 10, w: 100, h: 100 } }, ctx);
  assert.equal(f.captures[1].regionRef, full.shot);
  await f.invoke(TOOLS.captureDisplay, { displayId: 2 }, ctx);
  assert.equal(f.captures[2].displayId, 2);
});
