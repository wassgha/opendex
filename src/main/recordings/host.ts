import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, protocol, session, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { copyFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { IPC } from "../ipc/channels";
import { RecordingStore } from "./store";
import type { RecordingOptions, RecordingState } from "./types";

protocol.registerSchemesAsPrivileged([{ scheme: "opendex-recording", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

let state: RecordingState = { phase: "idle" };
let owner: WebContents | null = null;
let store: RecordingStore;
let selected: RecordingOptions | null = null;
let stateListener = () => {};
let finishing = false;
const stateObservers = new Set<(value: RecordingState) => void>();
let ensureRecorder = () => {};
let readyOwner: WebContents | null = null;
let pendingStart: { id: string; resolve: (state: RecordingState) => void; timer: ReturnType<typeof setTimeout>; sent: boolean } | null = null;
function settleStart(error?: string) {
  const pending = pendingStart;
  if (!pending) return;
  pendingStart = null;
  clearTimeout(pending.timer);
  if (error && state.phase === "idle") publish({ phase: "idle", error });
  pending.resolve(error ? { ...state, error } : state);
}
function dispatchStart() {
  if (pendingStart && !pendingStart.sent && readyOwner && !readyOwner.isDestroyed()) {
    pendingStart.sent = true;
    readyOwner.send(IPC.recordingStartRequested, pendingStart.id);
  }
}
export async function controlRecording(action: "start" | "stop"): Promise<RecordingState> {
  if (action === "stop") {
    stopRecording();
    if (state.phase === "idle") return state;
    return new Promise(resolve => {
      const changed = (value: RecordingState) => {
        if (value.phase !== "idle") return;
        clearTimeout(timer); stateObservers.delete(changed); resolve(value);
      };
      const timer = setTimeout(() => { stateObservers.delete(changed); resolve(state); }, 15000);
      stateObservers.add(changed);
    });
  }
  if (action !== "start") throw new Error("Unknown recording action.");
  if (pendingStart || state.phase !== "idle") return { ...state, error: "A recording is already starting or active." };
  return new Promise(resolve => {
    pendingStart = { id: randomUUID(), resolve, sent: false, timer: setTimeout(() => {
      stopRecording();
    }, 45000) };
    try { ensureRecorder(); dispatchStart(); }
    catch (error) { settleStart(String(error)); }
  });
}
export const recordingActive = () => state.phase !== "idle" || Boolean(pendingStart);
export const getRecordingState = () => state;
function publish(next: RecordingState) {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.recordingChanged, state);
  stateListener();
  for (const observer of stateObservers) observer(state);
}
export function stopRecording() {
  if (pendingStart?.sent && readyOwner && !readyOwner.isDestroyed()) readyOwner.send(IPC.recordingStopRequested);
  settleStart("Recording start was cancelled or timed out.");
  if (owner && !owner.isDestroyed()) {
    owner.send(IPC.recordingStopRequested);
    if (state.id) publish({ ...state, phase: "saving" });
  }
}

export function initRecordings(getSettings: () => BrowserWindow | null, onState: () => void, ensureSettings: () => void) {
  ensureRecorder = ensureSettings;
  stateListener = onState;
  store = new RecordingStore(join(app.getPath("userData"), "recordings"));
  const requireSettings = (sender: WebContents) => {
    if (sender !== getSettings()?.webContents) throw new Error("Recording controls are only available in Settings.");
  };
  ipcMain.handle(IPC.recordingControl, (_event, action) => controlRecording(action));
  ipcMain.on(IPC.recordingReady, event => {
    requireSettings(event.sender);
    readyOwner = event.sender;
    dispatchStart();
  });
  ipcMain.on(IPC.recordingStartResult, (event, id: string, error?: string) => {
    requireSettings(event.sender);
    if (pendingStart?.id === id) settleStart(error);
  });
  const requireOwner = (sender: WebContents, id: string) => {
    if (sender !== owner || id !== state.id) throw new Error("Recording is no longer active.");
  };
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const options = selected;
    if (!owner || owner.isDestroyed() || request.frame !== owner.mainFrame || !options || state.phase !== "starting") {
      callback({}); return;
    }
    const captureId = state.id;
    selected = null;
    void desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
      const video = sources.find(source => source.id === options.sourceId);
      if (!video || state.phase !== "starting" || state.id !== captureId) { callback({}); return; }
      callback({ video, ...(options.systemAudio ? { audio: "loopback" as const } : {}) });
    }).catch(() => callback({}));
  });
  ipcMain.handle(IPC.recordingSources, async event => {
    requireSettings(event.sender);
    return (await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })).map(({ id, name }) => ({ id, name }));
  });
  ipcMain.handle(IPC.recordingPrepare, async (event, options: RecordingOptions, mime: string) => {
    requireSettings(event.sender);
    if (state.phase !== "idle") throw new Error("A recording is already active.");
    if (!options || typeof options.sourceId !== "string" || typeof options.microphone !== "boolean" || typeof options.systemAudio !== "boolean") throw new Error("Invalid recording options.");
    owner = event.sender;
    publish({ phase: "starting" });
    try {
      const entry = await store.begin(options, mime);
      selected = options;
      publish({ phase: "starting", id: entry.id });
      return entry.id;
    } catch (error) { owner = null; publish({ phase: "idle" }); throw error; }
  });
  ipcMain.handle(IPC.recordingStarted, (event, id: string) => {
    requireOwner(event.sender, id);
    if (state.phase === "saving") throw new Error("Recording was stopped during startup.");
    publish({ phase: "recording", id, startedAt: Date.now() });
  });
  ipcMain.handle(IPC.recordingChunk, (event, id: string, bytes: ArrayBuffer) => {
    requireOwner(event.sender, id);
    if (finishing) throw new Error("Recording is finishing.");
    return store.append(id, bytes);
  });
  const finish = async (duration: number, error?: string) => {
    if (!state.id || finishing) return;
    finishing = true;
    const id = state.id;
    publish({ ...state, phase: "saving" });
    try { await store.finish(id, duration, Boolean(error)); }
    catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    finally {
      selected = null; owner = null; finishing = false;
      publish({ phase: "idle", ...(error ? { error: String(error).slice(0, 500) } : {}) });
    }
  };
  ipcMain.handle(IPC.recordingFinish, async (event, id: string, duration: number, error?: string) => {
    requireOwner(event.sender, id);
    await finish(duration, error);
  });
  // Preserve a partial clip if the recording renderer crashes or is reloaded.
  app.on("web-contents-created", (_event, contents) => {
    const interrupted = () => { if (contents === readyOwner) { readyOwner = null; settleStart("Recording window was interrupted."); } if (contents === owner) void finish(Date.now() - (state.startedAt ?? Date.now()), "Recording was interrupted. The partial video was kept."); };
    contents.on("render-process-gone", interrupted);
    contents.on("destroyed", interrupted);
    contents.on("did-start-navigation", (_e, _url, inPlace, isMain) => { if (!inPlace && isMain) interrupted(); });
  });
  ipcMain.handle(IPC.recordingState, () => state);
  ipcMain.handle(IPC.recordingStop, () => stopRecording());
  ipcMain.handle(IPC.recordingList, event => { requireSettings(event.sender); return store.list(); });
  ipcMain.handle(IPC.recordingExport, async (event, id: string) => {
    requireSettings(event.sender);
    if (id === state.id) throw new Error("Stop recording before exporting.");
    const entry = await store.get(id);
    const target = await dialog.showSaveDialog(getSettings()!, {
      title: "Export recording", defaultPath: join(app.getPath("videos"), `Dex-${new Date(entry.createdAt).toISOString().replace(/[:.]/g, "-")}.${entry.extension}`),
      filters: [{ name: entry.extension === "mp4" ? "MP4 video" : "WebM video", extensions: [entry.extension] }],
    });
    if (target.canceled || !target.filePath) return false;
    await copyFile(store.mediaPath(entry), target.filePath);
    return true;
  });
  ipcMain.handle(IPC.recordingTrash, (event, id: string) => { requireSettings(event.sender); return store.trash(id, path => shell.trashItem(path)); });
  ipcMain.handle(IPC.recordingReveal, async (event, id: string) => { requireSettings(event.sender); shell.showItemInFolder(store.mediaPath(await store.get(id))); });
  protocol.handle("opendex-recording", async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "video" || !["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 404 });
      const entry = await store.get(url.pathname.slice(1));
      if (entry.id === state.id) return new Response(null, { status: 409 });
      const path = store.mediaPath(entry);
      const { size } = await stat(path);
      let start = 0, end = size - 1;
      const range = request.headers.get("Range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
        if (!match[1]) start = Math.max(0, size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      const headers: Record<string, string> = { "Content-Type": entry.mimeType, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "no-store" };
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
  });
}
