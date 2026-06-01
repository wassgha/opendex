import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IPC, type ChatStartPayload } from "./ipc/channels";
import { streamChat } from "./agent/chat";
import { synthesizeSpeech } from "./tts/elevenlabs";

// Phase 1: load API keys from .env for the dev demo. Phase 2 replaces this with
// secure config (electron-store + safeStorage).
loadEnv();

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#050816",
    title: "OpenDex",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Open external links in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc() {
  // Track in-flight chat requests so the renderer can cancel (barge-in / stop).
  const inFlight = new Map<string, AbortController>();

  ipcMain.on(IPC.chatStart, async (event, payload: ChatStartPayload) => {
    const { requestId, messages, mode } = payload;
    const ac = new AbortController();
    inFlight.set(requestId, ac);
    const sender = event.sender;
    try {
      for await (const delta of streamChat({ messages, mode, signal: ac.signal })) {
        if (ac.signal.aborted || sender.isDestroyed()) break;
        sender.send(IPC.chatDelta(requestId), delta);
      }
      if (!sender.isDestroyed()) sender.send(IPC.chatDone(requestId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!sender.isDestroyed()) sender.send(IPC.chatError(requestId), message);
    } finally {
      inFlight.delete(requestId);
    }
  });

  ipcMain.on(IPC.chatCancel, (_event, requestId: string) => {
    inFlight.get(requestId)?.abort();
    inFlight.delete(requestId);
  });

  ipcMain.handle(IPC.ttsSynthesize, async (_event, text: string) => {
    const buffer = await synthesizeSpeech(text);
    // Return a clean ArrayBuffer (sliced to the exact view) so the renderer can
    // wrap it directly in a Blob.
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
