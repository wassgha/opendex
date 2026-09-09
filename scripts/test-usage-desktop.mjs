// Runs the built renderer and real preload against an isolated usage ledger.
// No user settings, provider credentials, microphone or network access are used.
import { build } from "vite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), "dex-usage-desktop-"));
const entry = join(directory, "harness.ts");
writeFileSync(entry, `
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { UsageLedger } from ${JSON.stringify(resolve("src/main/usage/ledger.ts"))};
import { DEFAULT_CONFIG } from ${JSON.stringify(resolve("src/main/config/schema.ts"))};
const directory = ${JSON.stringify(directory)};
app.setPath('userData', directory + '/profile');
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']}, (_details, done) => done({cancel:true}));
  const ledger = new UsageLedger(directory + '/usage', () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('usage:changed'); });
  const config = structuredClone(DEFAULT_CONFIG);
  config.onboarding.completed = true;
  config.voiceInput.wakeMode = 'manual';
  config.greeting.mode = 'none';
  ipcMain.handle('config:get', () => ({config, secrets:{}, encryptionAvailable:true}));
  ipcMain.handle('settings:section', () => 'usage');
  ipcMain.handle('usage:summary', () => ledger.summary());
  ipcMain.handle('usage:history', (_e, offset) => ledger.history(offset));
  ipcMain.handle('recording:state', () => ({phase:'idle'}));
  ipcMain.handle('screen-health:get', () => ({state:'ready'}));
  ipcMain.on('notch:set-size', (event, size) => BrowserWindow.fromWebContents(event.sender)?.setSize(Math.ceil(size.width), Math.ceil(size.height)));
  let opened = false;
  ipcMain.handle('settings:open', (_e, section) => { assert.equal(section, 'usage'); opened = true; });
  const errors: string[] = [];
  async function windowFor(hash: string, width: number, height: number) {
    const w = new BrowserWindow({show:false, frame:false, width, height, webPreferences:{preload:${JSON.stringify(resolve("out/preload/index.js"))}, contextIsolation:true, nodeIntegration:false, sandbox:false, backgroundThrottling:false}});
    w.webContents.on('console-message', ({level, message}) => { if(level === 'error' && !message.includes('Content Security Policy')) { errors.push(message); console.error('Renderer:', message); } });
    await w.loadFile(${JSON.stringify(resolve("out/renderer/index.html"))}, {hash});
    return w;
  }
  async function until(w: BrowserWindow, expression: string) {
    const end = Date.now() + 10000;
    while(Date.now() < end) { if(await w.webContents.executeJavaScript(expression)) return; await new Promise(r=>setTimeout(r,50)); }
    throw new Error('Timed out waiting for UI: ' + expression + '; renderer errors: ' + errors.join(', ') + '; body: ' + await w.webContents.executeJavaScript('document.body.innerText.slice(0,500)'));
  }
  const settings = await windowFor('settings', 920, 860);
  await until(settings, 'document.body.innerText.includes("No usage yet")');
  const id = ledger.start({provider:'gateway',model:'openai/gpt-realtime-2',category:'realtime'});
  await until(settings, 'document.body.innerText.includes("Pending")');
  ledger.finish(id, {inputTokens:1200,outputTokens:350,cachedTokens:200}, {usd:0.034,confidence:'estimated',basis:'Isolated desktop test pricing.',pricedAt:new Date().toISOString()});
  await until(settings, 'document.body.innerText.includes("$0.03")');
  const unpriced = ledger.start({provider:'gateway',model:'realtime input transcription',category:'transcription'});
  ledger.finish(unpriced,{credits:120},{usd:null,confidence:'unavailable',basis:'Credit usage requires a subscription plan to calculate dollars.'});
  await until(settings, 'document.body.innerText.includes("1 request without a dollar cost")');
  await until(settings, 'document.body.innerText.includes("Cost not reported")');
  assert.equal(await settings.webContents.executeJavaScript("Array.from(document.querySelectorAll('th[scope=rowgroup]')).filter(el => el.textContent === 'Vercel AI Gateway').length"), 1);
  assert.equal(await settings.webContents.executeJavaScript("document.querySelector('table').innerText.includes('Excluded from the subtotal.')"), true);
  assert.equal(await settings.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  writeFileSync(directory + '/settings.png', (await settings.webContents.capturePage()).toPNG());
  const notch = await windowFor('notch', 340, 68);
  await until(notch, 'document.body.innerText.includes("Today") && document.body.innerText.includes("$0.03")');
  await notch.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('Open usage and costs')).click()");
  assert.ok(opened, 'Notch meter must navigate to usage settings through preload IPC');
  assert.ok(await notch.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('Open usage and costs')).getBoundingClientRect().bottom <= innerHeight"), 'Meter must fit inside the notch');
  writeFileSync(directory + '/notch.png', (await notch.webContents.capturePage()).toPNG());
  const main = await windowFor('', 1000, 740);
  await until(main, 'document.body.innerText.includes("Since launch")');
  writeFileSync(directory + '/main.png', (await main.webContents.capturePage()).toPNG());
  // The main voice hook requests a mic; this isolated profile deliberately
  // denies capture. Its asynchronous denial may arrive before or after these
  // UI assertions; allow only that exact error and reject unrelated failures.
  assert.deepEqual(errors.filter(message => message !== '[opendex] mic permission denied [object DOMException]'), []);
  console.log('PASS: real Electron/preload/renderer round trip, empty/pending/estimated/unpriced states, notch navigation. Screenshots: ' + directory);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Desktop usage test timed out'); app.exit(1); }, 30000);
`);
await build({ configFile: false, logLevel: "error", build: { ssr: entry, outDir: join(directory, "build"), rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "harness.cjs" } } } });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [join(directory, "build/harness.cjs")], { env, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });
