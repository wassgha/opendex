import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { IPC, type ChatStartPayload } from "./ipc/channels";
import { streamChat } from "./agent/chat";
import { buildSystemPrompt } from "./agent/system-prompt";
import { synthesizeSpeech } from "./tts/elevenlabs";
import {
  completeOnboarding,
  getConfig,
  getPublicConfig,
  initConfig,
  setSecret,
  updateConfig,
} from "./config/store";
import type { DeepPartial, OpenDexConfig, SecretName } from "./config/schema";

// Load a dev .env first; initConfig() then layers the user's saved config on
// top (config values win; .env remains a fallback for unset secrets).
loadEnv();

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#0a0a0a",
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
  const inFlight = new Map<string, AbortController>();

  ipcMain.on(IPC.chatStart, async (event, payload: ChatStartPayload) => {
    const { requestId, messages, mode } = payload;
    const ac = new AbortController();
    inFlight.set(requestId, ac);
    const sender = event.sender;
    const config = getConfig();
    const briefing = mode === "briefing";
    const system = buildSystemPrompt({ config, briefing });
    try {
      for await (const delta of streamChat({
        messages,
        system,
        model: config.llm.model,
        briefing,
        signal: ac.signal,
      })) {
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
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  });

  // Config / secrets ---------------------------------------------------------
  ipcMain.handle(IPC.configGet, () => getPublicConfig());

  ipcMain.handle(IPC.configSet, (_event, patch: DeepPartial<OpenDexConfig>) =>
    updateConfig(patch),
  );

  ipcMain.handle(
    IPC.secretSet,
    (_event, name: SecretName, value: string) => setSecret(name, value),
  );

  ipcMain.handle(IPC.onboardingComplete, () => completeOnboarding());
}

app.whenReady().then(() => {
  initConfig();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
