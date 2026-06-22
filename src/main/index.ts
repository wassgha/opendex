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
import { initAutoUpdater } from "./updater";
import { initAnalytics, track } from "./analytics";

// Load a dev .env first; initConfig() then layers the user's saved config on
// top (config values win; .env remains a fallback for unset secrets).
loadEnv();

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 480,
    minWidth: 360,
    minHeight: 420,
    backgroundColor: "#0a0a0a",
    title: "OpenDex",
    show: false,
    // Frameless, native-feeling chrome on macOS: hide the title bar and let the
    // renderer fill to the top edge, keeping the traffic lights inset over it.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
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

  loadRenderer(win);
}

// Both windows share one renderer bundle; `hash` selects which experience mounts
// (the settings window passes "settings"; see src/renderer/src/main.tsx).
function loadRenderer(win: BrowserWindow, hash?: string) {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL;
    void win.loadURL(hash ? `${base}#${hash}` : base);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), { hash });
  }
}

let settingsWindow: BrowserWindow | null = null;

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: "#0a0a0a",
    title: "OpenDex Settings",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  loadRenderer(settingsWindow, "settings");
}

// Push the latest public config to every open window so the main experience and
// the settings window stay in sync after either one mutates config.
function broadcastConfig() {
  const cfg = getPublicConfig();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.configChanged, cfg);
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
    track("command_run", { mode: briefing ? "briefing" : "command" });
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
          // Tool name only — never the input args.
          track("tool_used", { tool_name: call.toolName });
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

  ipcMain.handle(IPC.configSet, (_event, patch: DeepPartial<OpenDexConfig>) => {
    const result = updateConfig(patch);
    broadcastConfig();
    return result;
  });

  ipcMain.handle(IPC.secretSet, (_event, name: SecretName, value: string) => {
    const result = setSecret(name, value);
    broadcastConfig();
    return result;
  });

  ipcMain.handle(IPC.settingsOpen, () => openSettingsWindow());

  ipcMain.handle(IPC.onboardingComplete, () => {
    const result = completeOnboarding();
    broadcastConfig();
    // Coarse, anonymized snapshot of which options the user chose — feature
    // popularity only, no content or identifiers.
    const c = result.config;
    track("onboarding_completed", {
      theme: c.appearance.theme,
      wake_mode: c.voiceInput.wakeMode,
      stt_provider: c.voiceInput.sttProvider,
      tts_engine: c.tts.engine,
      greeting_mode: c.greeting.mode,
    });
    return result;
  });

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
  initAnalytics();
  track("app_started");
  if (!getConfig().onboarding.completed) track("onboarding_started");
  registerIpc();
  createWindow();
  registerPushToTalkHotkey();
  registerInterruptHotkey();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  // Best-effort — the process may exit before the request lands.
  track("app_quit");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
