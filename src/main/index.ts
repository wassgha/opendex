import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { app, BrowserWindow, globalShortcut, ipcMain, shell } from "electron";
import { IPC, type ChatStartPayload } from "./ipc/channels";
import { streamChat } from "./agent/chat";
import { buildSystemPrompt } from "./agent/system-prompt";
import { buildToolSet, isSkillEnabled } from "./agent/skills/registry";
import { computerSkill } from "./agent/skills/computer";
import {
  makePermissionRequester,
  recordAndResolve,
  type PermissionDecision,
} from "./agent/permissions";
import { synthesizeSpeech } from "./tts/elevenlabs";
import { transcribe } from "./stt";
import {
  completeOnboarding,
  getConfig,
  getPicovoiceKey,
  getPublicConfig,
  initConfig,
  setSecret,
  updateConfig,
} from "./config/store";
import type { DeepPartial, OpenDexConfig, SecretName, SttProvider } from "./config/schema";

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
    const computerUse = !briefing && isSkillEnabled(computerSkill, config);
    const system = buildSystemPrompt({ config, briefing, computerUse });
    const tools = buildToolSet({
      config,
      requestPermission: makePermissionRequester(sender),
    });
    try {
      const responseMessages = await streamChat({
        messages,
        system,
        model: config.llm.model,
        tools,
        briefing,
        // Computer-use sessions need many screenshot→act→screenshot steps.
        maxSteps: computerUse ? 40 : 8,
        signal: ac.signal,
        onDelta: (delta) => {
          if (!ac.signal.aborted && !sender.isDestroyed()) {
            sender.send(IPC.chatDelta(requestId), delta);
          }
        },
        onToolCall: (call) => {
          if (!ac.signal.aborted && !sender.isDestroyed()) {
            sender.send(IPC.chatTool(requestId), call);
          }
        },
      });
      if (!sender.isDestroyed()) {
        sender.send(IPC.chatDone(requestId), responseMessages);
      }
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

  // STT ----------------------------------------------------------------------
  ipcMain.handle(
    IPC.transcribe,
    async (_event, provider: SttProvider, wav: ArrayBuffer) => {
      return transcribe(provider, Buffer.from(wav));
    },
  );

  // The one secret the renderer may read — Porcupine's WASM SDK needs it
  // client-side. Billing keys (OpenAI, etc.) never leave main.
  ipcMain.handle(IPC.getPicovoiceKey, () => getPicovoiceKey());

  // Permission gate: the renderer answers a sensitive-tool prompt.
  ipcMain.on(
    IPC.permissionRespond,
    (_event, payload: { id: string; skillId: string; decision: PermissionDecision }) => {
      recordAndResolve(payload.id, payload.skillId, payload.decision);
    },
  );
}

function registerPushToTalkHotkey() {
  // Global push-to-talk for manual wake mode. Forwarded to the focused window;
  // the renderer ignores it unless wakeMode === "manual".
  const accelerator = "CommandOrControl+Shift+Space";
  try {
    globalShortcut.register(accelerator, () => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.pushToTalk);
    });
  } catch (err) {
    console.error("[opendex] failed to register push-to-talk hotkey", err);
  }
}

function registerInterruptHotkey() {
  // Global emergency stop — works even while another app has focus (essential
  // during computer-use, where OpenDex isn't the focused window). Aborts the
  // running command in the renderer.
  const accelerator = "CommandOrControl+Escape";
  try {
    globalShortcut.register(accelerator, () => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.interrupt);
    });
  } catch (err) {
    console.error("[opendex] failed to register interrupt hotkey", err);
  }
}

app.whenReady().then(() => {
  initConfig();
  registerIpc();
  createWindow();
  registerPushToTalkHotkey();
  registerInterruptHotkey();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
