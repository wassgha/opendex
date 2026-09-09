// Run pnpm build first. Exercises the real window host, production renderer and
// restricted preload in a separate Electron process with an isolated profile.
import { build } from "vite";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const directory = realpathSync(mkdtempSync(join(tmpdir(), "dex-floating-widgets-")));
const entry = join(directory, "harness.ts");
writeFileSync(entry, `
import { app, BrowserWindow, ipcMain, session, screen } from 'electron';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { WidgetWindows } from ${JSON.stringify(resolve("src/main/widgets/windows.ts"))};
import { IPC } from ${JSON.stringify(resolve("src/main/ipc/channels.ts"))};
import { slotBounds, slotEdges, WIDGET_SLOTS } from ${JSON.stringify(resolve("src/main/widgets/magnet.ts"))};
const directory = ${JSON.stringify(directory)};
app.setPath('userData', directory + '/profile');
app.whenReady().then(async () => {
  session.fromPartition('opendex-widgets').webRequest.onBeforeRequest(
    {urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']}, (_d, done) => done({cancel:true}));
  const windows = new Map<string, BrowserWindow>();
  const errors: string[] = [];
  const host = new WidgetWindows(${JSON.stringify(resolve("out/preload/widget.js"))}, (w, id) => {
    windows.set(id, w);
    w.webContents.on('console-message', ({level, message}) => { if(level === 'error') errors.push(message); });
    w.loadFile(${JSON.stringify(resolve("out/renderer/index.html"))}, {hash:id === 'slots' ? 'widget-slots' : 'widget?id=' + id});
  });
  ipcMain.on(IPC.widgetsClose, event => host.close(event.sender));
  ipcMain.handle(IPC.widgetEdgesGet, event => host.getEdges(event.sender));
  ipcMain.handle(IPC.widgetSlotsShow, event => host.showSlots(event.sender));
  ipcMain.handle(IPC.widgetSlotsGet, event => host.getSlots(event.sender));
  ipcMain.handle(IPC.widgetSlotsChoose, (event, slot) => host.chooseSlot(event.sender, slot));
  const js = (w: BrowserWindow, code: string) => w.webContents.executeJavaScript(code).catch(error => { console.error("Failed fixture expression:", code, "Renderer errors:", errors); throw error; });
  async function until(check: () => Promise<boolean> | boolean) {
    const end = Date.now() + 10000;
    while(Date.now() < end) { if(await check()) return; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('Timed out. Renderer errors: ' + errors.join('; '));
  }
  async function click(w: BrowserWindow, selector: string) {
    await js(w, 'document.querySelector(' + JSON.stringify(selector) + ').click()');
    await js(w, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }
  host.show();
  const light = windows.get('light')!;
  const goal = windows.get('goal')!;
  await until(async () => light.isVisible() && goal.isVisible() && await js(light, 'Boolean(document.querySelector("[role=switch]"))'));
  for (const w of [light, goal]) {
    assert.equal(w.getParentWindow(), null);
    assert.equal(w.isAlwaysOnTop(), true);
    assert.equal(w.isMovable(), true);
    assert.equal(w.webContents.getLastWebPreferences().sandbox, true);
    assert.equal(await js(w, 'typeof window.opendex'), 'undefined');
    assert.equal(await js(w, 'typeof require'), 'undefined');
    assert.deepEqual(await js(w, 'Object.keys(window.opendexWidget).sort()'), ['chooseSlot','close','getEdges','getSlots','onEdgesChanged','onSlotsChanged','platform','showSlots']);
    assert.equal(await js(w, 'getComputedStyle(document.querySelector("header")).webkitAppRegion'), 'drag');
    assert.equal(await js(w, 'getComputedStyle(document.querySelector("button")).webkitAppRegion'), 'no-drag');
    assert.equal(await js(w, 'document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await js(w, 'Array.from(document.querySelectorAll("button")).every(b => { const r=b.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth; })'), true);
  }
  await click(light, '[role=switch]');
  assert.equal(await js(light, 'document.querySelector("[role=switch]").getAttribute("aria-checked")'), 'true');
  await new Promise(r => setTimeout(r, 250)); // Let the switch's CSS transition settle for visual QA.
  writeFileSync(directory + '/light-on.png', (await light.webContents.capturePage()).toPNG());
  await js(light, 'document.querySelector("[role=switch]").focus()');
  light.webContents.sendInputEvent({type:'keyDown', keyCode:'Space'});
  light.webContents.sendInputEvent({type:'keyUp', keyCode:'Space'});
  await until(async () => await js(light, 'document.querySelector("[role=switch]").getAttribute("aria-checked") === "false"'));
  for (let i = 0; i < 10; i++) await click(goal, '[aria-label="Add one step"]');
  assert.equal(await js(goal, 'document.querySelector("output").textContent'), '8');
  assert.equal(await js(goal, 'document.querySelector("progress").value'), 8);
  assert.equal(await js(goal, 'document.querySelector("[role=status]").textContent'), 'Goal reached!');
  writeFileSync(directory + '/goal-complete.png', (await goal.webContents.capturePage()).toPNG());
  await click(goal, '[aria-label="Remove one step"]');
  assert.equal(await js(goal, 'document.querySelector("output").textContent'), '7');
  const area = screen.getDisplayMatching(goal.getBounds()).bounds;
  light.setPosition(area.x + 100, area.y + 100);
  await new Promise(r => setTimeout(r, 220));
  async function pickerFor(w: BrowserWindow) {
    await js(w, 'document.querySelector("header button").click()');
    await until(() => Boolean(windows.get('slots') && !windows.get('slots')!.isDestroyed()));
    const picker = windows.get('slots')!;
    await until(async () => picker.isVisible() && await js(picker, 'document.querySelectorAll("[data-target]").length === 8'));
    return picker;
  }
  async function choose(w: BrowserWindow, slot: string) {
    const picker = await pickerFor(w);
    await js(picker, 'document.querySelector(' + JSON.stringify('[data-target="' + slot + '"]') + ').click()');
    await until(() => picker.isDestroyed());
    await until(() => host.getEdges(w.webContents).slot === slot);
  }
  // Inject native post-placement movement after the old 160ms debounce would
  // have finished. This must neither discard the claim nor create a new picker.
  await choose(light, 'top-left');
  const closedPicker = windows.get('slots')!;
  const anchor = light.getBounds();
  if (process.platform === 'darwin' || process.platform === 'win32') {
    await new Promise(r => setTimeout(r, 220));
    light.setPosition(anchor.x, anchor.y + 33); // Simulated late menu-bar/focus adjustment.
    light.emit('move');
    await new Promise(r => setTimeout(r, 400));
    assert.equal(host.getEdges(light.webContents).slot, 'top-left');
    assert.deepEqual(light.getBounds(), anchor);
    assert.equal(windows.get('slots'), closedPicker);
    assert.ok(closedPicker.isDestroyed(), 'The picker must stay closed after docking settles');
    light.emit('move');
    await new Promise(r => setTimeout(r, 220));
    assert.equal(windows.get('slots'), closedPicker);
  }
  // Actual dragging is identified by will-move, not by setPosition alone.
  const manualMove = (w: BrowserWindow, x: number, y: number) => {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      w.emit('will-move', {preventDefault() {}}, {...w.getBounds(), x, y});
    }
    w.setPosition(x, y);
  };
  manualMove(light, area.x + 100, area.y + 100);
  await until(() => host.getEdges(light.webContents).slot === null);
  for (const slot of WIDGET_SLOTS) {
    const target = slotBounds(goal.getBounds(), area, slot);
    await choose(goal, slot);
    assert.deepEqual(goal.getBounds(), target);
    await until(async () => await js(goal, 'document.querySelector("section").dataset.slot === ' + JSON.stringify(slot)));
    const expected = slotEdges(slot);
    const shape = await js(goal, '(() => { const s=getComputedStyle(document.querySelector("section")); return {tl:s.borderTopLeftRadius,tr:s.borderTopRightRadius,bl:s.borderBottomLeftRadius,br:s.borderBottomRightRadius,top:s.borderTopWidth,bottom:s.borderBottomWidth,left:s.borderLeftWidth,right:s.borderRightWidth}; })()');
    assert.equal(shape.tl, expected.vertical === 'top' || expected.horizontal === 'left' ? '0px' : '16px');
    assert.equal(shape.tr, expected.vertical === 'top' || expected.horizontal === 'right' ? '0px' : '16px');
    assert.equal(shape.bl, expected.vertical === 'bottom' || expected.horizontal === 'left' ? '0px' : '16px');
    assert.equal(shape.br, expected.vertical === 'bottom' || expected.horizontal === 'right' ? '0px' : '16px');
    assert.equal(shape.top, expected.vertical === 'top' ? '0px' : '1px');
    assert.equal(shape.bottom, expected.vertical === 'bottom' ? '0px' : '1px');
    assert.equal(shape.left, expected.horizontal === 'left' ? '0px' : '1px');
    assert.equal(shape.right, expected.horizontal === 'right' ? '0px' : '1px');
  }
  await choose(light, 'middle-left');
  const goalBefore = goal.getBounds();
  const picker = await pickerFor(goal);
  assert.equal(await js(picker, 'document.querySelector("h1").textContent'), 'Dock Goal counter');
  assert.equal(await js(picker, 'document.querySelector("[data-target=middle-left]").disabled'), true);
  assert.equal(await js(picker, 'document.querySelector("[data-target=top-left]").disabled'), false);
  assert.equal(await js(picker, 'window.opendexWidget.chooseSlot("middle-left")'), false);
  assert.deepEqual(goal.getBounds(), goalBefore, 'Occupied selection must not bounce or move the widget');
  await js(picker, 'document.querySelector("[data-target=top-left]").focus()');
  await until(async () => await js(picker, 'Boolean(document.querySelector("[data-preview=top-left]"))'));
  const preview = await js(picker, '(() => { const r=document.querySelector("[data-preview=top-left]").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()');
  assert.deepEqual(preview, {x:0,y:0,width:goalBefore.width,height:goalBefore.height});
  writeFileSync(directory + '/visible-slots.png', (await picker.webContents.capturePage()).toPNG());
  await js(picker, 'document.querySelector("[data-target=top-left]").click()');
  await until(() => picker.isDestroyed());
  assert.equal(host.getEdges(goal.webContents).slot, 'top-left');
  assert.equal(host.getEdges(light.webContents).slot, 'middle-left');
  const another = await pickerFor(goal);
  another.webContents.sendInputEvent({type:'keyDown', keyCode:'Escape'});
  await until(() => another.isDestroyed());
  assert.equal(host.getEdges(goal.webContents).slot, 'top-left');
  // Reproduce the original drag near an occupied middle-left slot: no auto-placement or bounce.
  const drop = slotBounds(goal.getBounds(), area, 'middle-left');
  manualMove(goal, drop.x + 10, drop.y);
  await until(() => host.getEdges(goal.webContents).slot === null && Boolean(windows.get('slots')?.isVisible()));
  assert.equal(goal.getBounds().x, drop.x + 10);
  assert.equal(host.getEdges(light.webContents).slot, 'middle-left');
  const dragPicker = windows.get('slots')!;
  await until(async () => await js(dragPicker, 'document.querySelectorAll("[data-target]").length === 8'));
  await js(dragPicker, 'window.opendexWidget.close()');
  await until(() => dragPicker.isDestroyed());
  assert.equal(goal.getBounds().x, drop.x + 10);
  // An unrelated window cannot close either widget; its lifecycle has no effect.
  const other = new BrowserWindow({show:false});
  host.close(other.webContents);
  other.hide();
  other.destroy();
  assert.equal(light.isVisible() && goal.isVisible(), true);
  const position = light.getPosition();
  host.show();
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.deepEqual(light.getPosition(), position);
  assert.equal(await js(goal, 'document.querySelector("output").textContent'), '7');
  const oldLightId = light.id;
  await js(light, 'document.querySelector("header button:last-child").click()');
  await until(() => light.isDestroyed());
  assert.equal(goal.isVisible(), true);
  await choose(goal, 'middle-left');
  host.show();
  const reopened = windows.get('light')!;
  assert.notEqual(reopened.id, oldLightId);
  await until(async () => reopened.isVisible() && await js(reopened, 'Boolean(document.querySelector("[role=switch]"))'));
  assert.equal(await js(reopened, 'document.querySelector("[role=switch]").getAttribute("aria-checked")'), 'false');
  assert.equal(await js(goal, 'document.querySelector("output").textContent'), '7');
  await js(goal, 'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Reset").click()');
  await until(async () => await js(goal, 'document.querySelector("output").textContent === "0"'));
  assert.equal(await js(goal, 'document.querySelector("[aria-label=" + JSON.stringify("Remove one step") + "]").disabled'), true);
  assert.deepEqual(errors, []);
  console.log('PASS: independent windows, restricted preload, drag regions, switch click/Space, counter bounds/reset, singleton reopen, position/state retention, independent close, visible slot picker, occupied targets, exact preview, explicit selection, Escape cancellation, no drag bounce, late native moves keep picker closed and slot locked, manual drag release, exclusive ownership, notch silhouettes. Screenshots: ' + directory);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Widget test timed out'); app.exit(1); }, 30000);
`);
await build({ configFile: false, logLevel: "error", build: { ssr: entry, outDir: join(directory, "build"), rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "harness.cjs" } } } });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [join(directory, "build/harness.cjs")], { env, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
