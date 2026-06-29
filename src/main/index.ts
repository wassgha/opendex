import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from "electron";
import {
  IPC,
  type ChatStartPayload,
  type SessionState,
  type ViewCommand,
  type WindowMode,
} from "./ipc/channels";
import { streamChat } from "./agent/chat";
import { resolveModel, checkAppleAvailability } from "./agent/llm/resolve-model";
import { buildSystemPrompt } from "./agent/system-prompt";
import { buildToolSet, skillSystemPrompts } from "../skills/registry";
import {
  makePermissionRequester,
  pendingPermissions,
  recordAndResolve,
  setPermissionUi,
  type PermissionDecision,
} from "./agent/permissions";
import { synthesizeSpeech } from "./tts/elevenlabs";
import { transcribe } from "./stt";
import {
  completeOnboarding,
  getConfig,
  getPublicConfig,
  initConfig,
  resetConfig,
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

// The single main window hosts the entire voice session (mic/STT/TTS run only
// in its renderer). We hide it rather than destroy it (see the close handler +
// summon hotkey) so the session survives while out of sight; the overlay HUD
// and notch bar are how the user sees/drives it when it isn't on screen.
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let permissionWindow: BrowserWindow | null = null;
// The notch bar is its OWN transparent window (not the reshaped main window) so
// CSS controls its shape — a flat top edge flush to the screen, rounded bottom,
// "part of the notch" — which an opaque, OS-corner-rounded window can't do.
let notchWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Current layout. In `notch`, the main window is hidden and the notch window
// shown; in `full`, vice-versa. The voice session always lives in the (possibly
// hidden) main window — the notch is a view that relays actions back to it.
let windowMode: WindowMode = "full";

// Last session snapshot, replayed to view surfaces (overlay/notch) as they load
// so a freshly-created window paints immediately instead of waiting for a change.
let latestSessionState: SessionState | null = null;

// The renderer drives the notch's size (the CompactBar measures its own content
// and calls setNotchSize) — compact at rest, wider/taller as a caption, card, or
// the type field appears. `NOTCH_SIZE` is the initial/min footprint; the window
// stays centered as it resizes. Clamp to sane bounds so a renderer bug can't take
// over the screen.
const NOTCH_SIZE = { width: 320, height: 44 };
const NOTCH_MIN_WIDTH = 280;
const NOTCH_MAX_WIDTH = 640;
const NOTCH_MAX_HEIGHT = 260;

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
      // The window is often hidden/occluded while the agent works; without this,
      // the OS throttles its timers + rAF to ~1fps, stalling wake-word polling,
      // the amplitude meter, and STT endpointing. Keep the voice loop full-speed.
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => win.show());

  // Closing the window (red traffic light / Ctrl+W) collapses to the notch
  // instead of tearing down the renderer — that would kill the live voice
  // session. The session keeps running in the (now hidden) main window behind
  // the notch. Before onboarding finishes we just hide, since the wizard always
  // runs full. A real quit goes through the tray or ⌘Q (isQuitting), and only
  // then do we let it close.
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (getConfig().onboarding.completed) applyWindowMode("notch");
    else win.hide();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  attachAutoModeListeners(win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  loadRenderer(win);
}

// Both windows share one renderer bundle; `hash` selects which experience mounts
// (the settings window passes "settings"; see src/renderer/src/main.tsx).
function loadRenderer(win: BrowserWindow, hash?: string) {
  const onLoadError = (err: unknown) =>
    console.error("[opendex] failed to load renderer", { hash }, err);
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL;
    win.loadURL(hash ? `${base}#${hash}` : base).catch(onLoadError);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { hash }).catch(onLoadError);
  }
}

// ── Overlay HUD ─────────────────────────────────────────────────────────────
// A transparent, click-through, always-on-top window that floats the action
// hints + Stop button over the whole desktop — visible even when the main
// window is hidden/behind another app (the normal case during computer-use). It
// renders the `#overlay` experience (see src/renderer/src/main.tsx).
function createOverlayWindow() {
  const overlay = new BrowserWindow({
    // Spans the work area of the primary display as a thin top strip; the
    // renderer centers its content and stays otherwise empty/transparent.
    width: 100,
    height: 100,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    // Keep it off mission-control / app-switcher; it's pure chrome.
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow = overlay;
  // Click-through by default; the renderer flips this off while the pointer is
  // over the Stop button (forward:true is what lets it receive the hover events).
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // Float above everything, including another app's fullscreen space, and follow
  // the user across Spaces — essential while driving a fullscreen app.
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep the HUD out of Mission Control / the Spaces bar (it's chrome, not a window).
  if (process.platform === "darwin") overlay.setHiddenInMissionControl(true);

  positionOverlay(overlay);
  overlay.on("closed", () => {
    if (overlayWindow === overlay) overlayWindow = null;
  });

  // Paint the last-known state as soon as the renderer is ready.
  overlay.webContents.on("did-finish-load", () => {
    if (latestSessionState) overlay.webContents.send(IPC.sessionChanged, latestSessionState);
  });

  loadRenderer(overlay, "overlay");
}

// Size/position the overlay to a top strip on the display under the cursor (so
// it tracks whichever monitor is being controlled during computer-use).
function positionOverlay(overlay: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  // Start below where the notch bar sits so the HUD's banners never collide with
  // it when both are on screen during a command.
  overlay.setBounds({ x, y: y + NOTCH_SIZE.height + 8, width, height: 160 });
}

// ── Permission popup ──────────────────────────────────────────────────────────
// A dedicated, always-on-top, focusable window for sensitive-tool prompts. Lives
// outside the main window so a prompt is visible whatever the main window is
// doing (hidden / notch / behind the driven app), and answering it never changes
// the main window's layout. Created hidden; shown on demand, hidden when no
// prompts remain. Renders the `#permission` experience (src/renderer/src/main.tsx).
const PERMISSION_SIZE = { width: 460, height: 360 };

function createPermissionWindow() {
  const win = new BrowserWindow({
    ...PERMISSION_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  permissionWindow = win;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === "darwin") win.setHiddenInMissionControl(true);
  win.on("closed", () => {
    if (permissionWindow === win) permissionWindow = null;
  });
  loadRenderer(win, "permission");
  return win;
}

function showPermissionWindow() {
  const win =
    permissionWindow && !permissionWindow.isDestroyed()
      ? permissionWindow
      : createPermissionWindow();
  // Center on the display under the cursor and float above everything (incl. a
  // fullscreen app being driven), then take focus so it can be answered.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  win.setBounds({
    x: Math.round(x + (width - PERMISSION_SIZE.width) / 2),
    y: Math.round(y + (height - PERMISSION_SIZE.height) / 2),
    ...PERMISSION_SIZE,
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.show();
  win.focus();
}

// ── Notch window ──────────────────────────────────────────────────────────────
// A transparent, frameless, always-on-top bar pinned to the very top-center of
// the screen. Transparency lets CSS draw a flat top edge flush to the screen
// (rounded bottom only) — the "part of the notch" look an opaque, OS-rounded
// window can't achieve. It's a view: it reads the session snapshot and relays
// actions (type / mute / expand) to the main window via `view:command`.
function createNotchWindow() {
  const win = new BrowserWindow({
    ...NOTCH_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false, // we draw our own (square top, rounded bottom)
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  notchWindow = win;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin") win.setHiddenInMissionControl(true);
  win.on("closed", () => {
    if (notchWindow === win) notchWindow = null;
  });
  win.webContents.on("did-finish-load", () => {
    if (latestSessionState) win.webContents.send(IPC.sessionChanged, latestSessionState);
  });
  loadRenderer(win, "notch");
  return win;
}

// Pin the notch flush to the very top-center of the display under the cursor,
// using full display bounds (not workArea) so it sits at the physical top edge.
function placeNotch(win: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = win.getBounds();
  // Preserve the renderer-driven size (it owns width+height via setNotchSize) and
  // just re-center it on the top edge of the display under the cursor.
  win.setBounds({
    x: Math.round(display.bounds.x + (display.bounds.width - b.width) / 2),
    y: display.bounds.y,
    width: b.width,
    height: b.height,
  });
}

// Set the notch size, kept centered on the top edge so the cursor stays over the
// bar as it grows (otherwise the window would slide out from under the pointer
// and hover would flicker).
function setNotchSize(width: number, height: number) {
  // No windowMode guard: the notch renderer keeps its (possibly hidden) window
  // sized correctly even while full mode is active, so re-showing it is instant
  // and never stale. Resizing a hidden window is harmless.
  if (!notchWindow || notchWindow.isDestroyed()) return;
  const b = notchWindow.getBounds();
  const w = Math.max(NOTCH_MIN_WIDTH, Math.min(Math.round(width), NOTCH_MAX_WIDTH));
  const h = Math.max(NOTCH_SIZE.height, Math.min(Math.round(height), NOTCH_MAX_HEIGHT));
  // Re-center horizontally on the notch's current display; keep it pinned to top.
  const display = screen.getDisplayNearestPoint({ x: Math.round(b.x + b.width / 2), y: b.y });
  const x = Math.round(display.bounds.x + (display.bounds.width - w) / 2);
  if (b.width === w && b.height === h && b.x === x) return;
  // animate: true → Cocoa tweens the resize on macOS (ignored elsewhere) so the
  // notch eases between sizes instead of snapping.
  notchWindow.setBounds({ x, y: display.bounds.y, width: w, height: h }, true);
}

// ── Layout: full (main window) ↔ notch (notch window) ─────────────────────────
// Switching mode hides one window and shows the other; the session keeps running
// in the main window regardless of its visibility. Notch is engaged automatically
// when OpenDex loses focus / the agent drives another app (attachAutoModeListeners);
// returning to full is explicit (the notch's expand button), so focusing the bar
// to type into it doesn't expand it. Not a user setting.
function applyWindowMode(mode: WindowMode) {
  if (mode === windowMode) return;
  windowMode = mode;

  if (mode === "notch") {
    const notch =
      notchWindow && !notchWindow.isDestroyed() ? notchWindow : createNotchWindow();
    placeNotch(notch);
    notch.showInactive(); // don't steal focus (esp. mid computer-use)
    mainWindow?.hide();
  } else {
    notchWindow?.hide();
    if (process.platform === "darwin") app.dock?.show();
    mainWindow?.show();
    mainWindow?.focus();
  }
  mainWindow?.webContents.send(IPC.windowMode, mode);
}

// Auto-engage notch when the full window loses focus — clicked away, or the agent
// is driving another app during computer-use (which steals focus). Only after
// onboarding so the wizard always runs full.
function attachAutoModeListeners(win: BrowserWindow) {
  win.on("blur", () => {
    // Don't collapse to notch when the blur is the permission popup taking focus
    // — answering a prompt shouldn't change the main window's layout.
    if (
      getConfig().onboarding.completed &&
      win.isVisible() &&
      pendingPermissions() === 0
    ) {
      applyWindowMode("notch");
    }
  });
}

// Spotlight-style summon: toggle whichever surface the current mode uses. In
// notch mode this shows + focuses the bar so you can type immediately.
function summonWindow({ toggle = true }: { toggle?: boolean } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (windowMode === "notch") {
    const notch =
      notchWindow && !notchWindow.isDestroyed() ? notchWindow : createNotchWindow();
    if (toggle && notch.isVisible() && notch.isFocused()) {
      notch.hide();
      return;
    }
    placeNotch(notch);
    notch.show();
    notch.focus();
    notch.webContents.send(IPC.windowSummoned);
    return;
  }
  const win = mainWindow;
  if (!win) return;
  if (toggle && win.isVisible() && win.isFocused()) {
    win.hide();
    return;
  }
  if (process.platform === "darwin") app.dock?.show();
  win.show();
  win.focus();
  win.webContents.send(IPC.windowSummoned);
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

// Re-broadcast the latest session snapshot to view-only surfaces, and show/hide
// the overlay HUD: it only appears while the agent is actively working (or has a
// live action hint), so it's invisible at rest.
function broadcastSessionState(state: SessionState) {
  latestSessionState = state;
  const busy =
    state.status === "thinking" ||
    state.status === "speaking" ||
    state.activity.length > 0;
  const overlay = overlayWindow;
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send(IPC.sessionChanged, state);
    if (busy && !overlay.isVisible()) {
      positionOverlay(overlay);
      overlay.showInactive(); // never steals focus from the app being controlled
    } else if (!busy && overlay.isVisible()) {
      overlay.hide();
    }
  }
  // The notch bar reflects status/caption live whenever it's on screen.
  if (notchWindow && !notchWindow.isDestroyed()) {
    notchWindow.webContents.send(IPC.sessionChanged, state);
  }
}

// Tool results stream to the renderer for result cards, but computer-use tools
// return `{ type: "content", value: [...media...] }` screenshots — replace those
// with a tiny placeholder so the IPC payload (and the renderer) stay light.
function stripImageOutput(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    (output as { type?: string }).type === "content" &&
    Array.isArray((output as { value?: unknown[] }).value) &&
    (output as { value: Array<{ type?: string }> }).value.some(
      (c) => c.type === "media" || c.type === "file-data",
    )
  ) {
    return { type: "content", value: [{ type: "text", value: "[screenshot]" }] };
  }
  return output;
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
    const system = buildSystemPrompt({
      config,
      briefing,
      skillPrompts: briefing ? [] : skillSystemPrompts(config),
    });
    const tools = buildToolSet({
      config,
      requestPermission: makePermissionRequester(sender),
    });
    try {
      // Resolve the configured provider to a model (may throw for an unset key,
      // an unavailable Apple model, or the not-yet-built subscription). The
      // catch below turns it into a spoken apology.
      const model = await resolveModel(config);
      const responseMessages = await streamChat({
        messages,
        system,
        model,
        tools,
        briefing,
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
        onToolResult: (result) => {
          if (!ac.signal.aborted && !sender.isDestroyed()) {
            sender.send(IPC.chatToolResult(requestId), {
              ...result,
              // Computer-use returns full screenshots; don't ship megabytes of
              // base64 to the activity UI (which never renders them as cards).
              output: stripImageOutput(result.output),
            });
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
    // Re-bind the global summon shortcut if the user rebound it in Settings.
    if (patch.hotkeys?.summon) registerSummonHotkey();
    return result;
  });

  ipcMain.handle(IPC.secretSet, (_event, name: SecretName, value: string) => {
    const result = setSecret(name, value);
    broadcastConfig();
    return result;
  });

  ipcMain.handle(IPC.configReset, () => {
    const result = resetConfig();
    broadcastConfig();
    track("config_reset");
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

  // Probe whether the Apple on-device model can run (gates the provider picker).
  ipcMain.handle(IPC.llmAppleAvailability, () => checkAppleAvailability());

  // Permission gate: the renderer answers a sensitive-tool prompt.
  ipcMain.on(
    IPC.permissionRespond,
    (_event, payload: { id: string; skillId: string; decision: PermissionDecision }) => {
      recordAndResolve(payload.id, payload.skillId, payload.decision);
    },
  );

  // Session-state relay: the main window publishes, main re-broadcasts to views.
  ipcMain.on(IPC.sessionUpdate, (_event, state: SessionState) => {
    broadcastSessionState(state);
  });

  // Window mode (full ↔ notch), requested from the renderer.
  ipcMain.on(IPC.windowSetMode, (_event, mode: WindowMode) => {
    applyWindowMode(mode);
  });

  // Notch hover → grow/shrink the notch window.
  ipcMain.on(IPC.notchSetSize, (_event, size: { width: number; height: number }) => {
    setNotchSize(size?.width ?? NOTCH_SIZE.width, size?.height ?? NOTCH_SIZE.height);
  });

  ipcMain.on(IPC.notchFocus, () => {
    if (windowMode === "notch" && notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.focus();
    }
  });

  // The notch (a view-only window) relays session actions: `expand` switches
  // back to the full window; the rest run against `useDex` in the main window.
  ipcMain.on(IPC.viewCommand, (_event, cmd: ViewCommand) => {
    if (cmd.type === "expand") {
      applyWindowMode("full");
    } else {
      mainWindow?.webContents.send(IPC.remoteCommand, cmd);
    }
  });

  // Overlay HUD: toggle click-through, and relay its Stop button to the main
  // window's interrupt path (the same channel the global hotkey uses).
  ipcMain.on(IPC.overlaySetInteractive, (_event, interactive: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on(IPC.overlayInterrupt, () => {
    mainWindow?.webContents.send(IPC.interrupt);
  });
}

function registerPushToTalkHotkey() {
  // Global push-to-talk for manual wake mode. The renderer ignores it unless
  // wakeMode === "manual".
  const accelerator = "CommandOrControl+Shift+Space";
  try {
    globalShortcut.register(accelerator, () => {
      mainWindow?.webContents.send(IPC.pushToTalk);
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
      mainWindow?.webContents.send(IPC.interrupt);
    });
  } catch (err) {
    console.error("[opendex] failed to register interrupt hotkey", err);
  }
}

let summonAccelerator = "";

// Spotlight/Siri-style summon: toggle the main window from anywhere. Tries the
// configured accelerator first; if it can't be registered (e.g. Alt+Space is
// reserved for the system window menu on Windows), falls back to a safe chord.
function registerSummonHotkey() {
  if (summonAccelerator) {
    globalShortcut.unregister(summonAccelerator);
    summonAccelerator = "";
  }
  const configured = getConfig().hotkeys.summon;
  const candidates = [configured, "Control+Alt+Space", "Control+Shift+Space"];
  for (const accelerator of candidates) {
    if (!accelerator || globalShortcut.isRegistered(accelerator)) continue;
    try {
      const ok = globalShortcut.register(accelerator, () => summonWindow());
      if (ok) {
        summonAccelerator = accelerator;
        return;
      }
    } catch {
      // try the next candidate
    }
  }
  console.error("[opendex] failed to register a summon hotkey");
}

function createTray() {
  if (tray) return;
  // A 1px transparent image is a safe cross-platform placeholder; a real
  // template icon ships in build resources later. An empty tray still works as
  // the anchor + menu when every window is hidden.
  const icon = nativeImage.createEmpty();
  try {
    tray = new Tray(icon);
  } catch (err) {
    console.error("[opendex] failed to create tray", err);
    return;
  }
  tray.setToolTip("OpenDex");
  const menu = Menu.buildFromTemplate([
    { label: "Show OpenDex", click: () => summonWindow({ toggle: false }) },
    { type: "separator" },
    { label: "Settings…", click: () => openSettingsWindow() },
    { type: "separator" },
    {
      label: "Quit OpenDex",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => summonWindow());
}

app.whenReady().then(() => {
  initConfig();
  initAnalytics();
  track("app_started");
  if (!getConfig().onboarding.completed) track("onboarding_started");
  registerIpc();
  createWindow();
  createOverlayWindow();
  createNotchWindow();
  createPermissionWindow();
  createTray();

  // Route sensitive-tool prompts to the dedicated popup window.
  setPermissionUi({
    present: (req) => {
      showPermissionWindow();
      const win = permissionWindow;
      if (!win) return;
      const send = () => {
        if (!win.isDestroyed()) win.webContents.send(IPC.permissionRequest, req);
      };
      // If the popup is still loading (first open), defer until it's ready.
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
      else send();
    },
    dismiss: (id) => {
      permissionWindow?.webContents.send(IPC.permissionDismiss, id);
      // Once nothing is awaiting an answer, tuck the popup away again.
      if (pendingPermissions() === 0) permissionWindow?.hide();
    },
  });

  registerPushToTalkHotkey();
  registerInterruptHotkey();
  registerSummonHotkey();
  initAutoUpdater();

  app.on("activate", () => {
    // Dock click / re-activate: bring the existing window forward (it's hidden,
    // not destroyed) rather than spawning a duplicate.
    summonWindow({ toggle: false });
  });
});

app.on("before-quit", () => {
  // Let the main window actually close instead of hiding (see its close handler).
  isQuitting = true;
  // Best-effort — the process may exit before the request lands.
  track("app_quit");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
