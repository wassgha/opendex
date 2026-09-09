import { delegatedDesktopJob } from "./agent/realtime/session-host";
import { RealtimeNoticeBuffer } from "./agent/realtime/notice-buffer";
import { desktopProgress } from "./agent/realtime/desktop-status";
import { bindBenchmarkWorker } from "./benchmarks/host";
import { WidgetWindows } from "./widgets/windows";
import { diagnosticToolOutcome } from "./diagnostics/tool-outcome";
import { initUsage, usageSummary, usageHistory } from "./usage/ledger";
import { configureInteractionLog, recordInteraction } from "./diagnostics/interaction-log";
import { observeDiagnosticSession } from "./diagnostics/runtime";
import { initRecordings, recordingActive, getRecordingState, stopRecording } from "./recordings/host";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createTrayIcon } from "./tray-icon";
import { config as loadEnv } from "dotenv";
import { tool } from "ai";
import { z } from "zod";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  systemPreferences,
  shell,
  Tray,
} from "electron";
import {
  IPC,
  type ChatStartPayload,
  type RealtimeClientMessage,
  type RealtimeStartResult,
  type SessionState,
  type ViewCommand,
  type WindowMode,
} from "./ipc/channels";
import { streamChat } from "./agent/chat";
import { screenOnWakeEnabled, SCREEN_ON_WAKE_INSTRUCTIONS } from "./agent/screen-on-wake";
import { checkScreenHealth, clearScreenHealth, getScreenHealth, latestScreenObservation, onScreenHealth } from "./screen-health";
import { screenBillingUrl } from "./config/screen-health";
import { resolveModel, checkAppleAvailability } from "./agent/llm/resolve-model";
import { buildRealtimeInstructions, buildSystemPrompt } from "./agent/system-prompt";
import {
  endRealtimeSession,
  sendRealtimeClientMessage,
  startRealtimeSession,
} from "./agent/realtime/session-host";
import { buildRealtimeToolDefs, directRealtimeSkills } from "./agent/realtime/realtime-tools";
import { getRealtimeModelMeta } from "./config/realtime-models";
import { buildToolSet, skillSystemPrompts } from "../skills/registry";
import { isDirectTool } from "../skills/realtime-selection";
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
let recordingQuitPending = false;

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
const NOTCH_MAX_HEIGHT = 640; // research record, captions, and expanded controls

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
  if (!app.isPackaged && process.platform === "darwin") console.log("[computer-permissions]", {
    screen: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  });
  if (!app.isPackaged) win.webContents.on("console-message", (_event, _level, message) => {
    if (message.startsWith("[voice-state]")) console.log(message);
  });

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

// Detached local widgets have no parent and do not follow full/notch mode.
const widgetWindows = new WidgetWindows(
  join(__dirname, "../preload/widget.js"),
  (win, id) => loadRenderer(win, id === "slots" ? "widget-slots" : `widget?id=${id}`),
);

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
  const { x, y, width, height } = display.workArea;
  // Float the hints at the BOTTOM of the work area (above the Dock) so they sit
  // out of the way of the notch bar at the top. The HUD content is bottom-anchored
  // (Stop at bottom-4, banners stacking up from bottom-16); tall enough for the
  // Stop control + the few activity banners above it.
  const h = 260;
  overlay.setBounds({ x, y: y + height - h, width, height: h });
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
let settingsSection = "assistant";

function openSettingsWindow(section?: string, hidden = false) {
  if (section) settingsSection = section;
  const navigate = () => {
    if (section) settingsWindow?.webContents.send(IPC.settingsNavigate, section);
  };
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!hidden) { settingsWindow.show(); settingsWindow.focus(); }
    navigate();
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
      backgroundThrottling: false,
    },
  });

  settingsWindow.once("ready-to-show", () => { if (!hidden) settingsWindow?.show(); navigate(); });
  settingsWindow.on("close", event => {
    if (recordingActive() && !isQuitting) { event.preventDefault(); settingsWindow?.hide(); }
  });
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
  observeDiagnosticSession(state);
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
  ipcMain.handle(IPC.widgetsOpen, (event) => {
    if (event.sender !== mainWindow?.webContents) {
      throw new Error("Open widgets from the main Dex window.");
    }
    widgetWindows.show();
  });
  ipcMain.on(IPC.widgetsClose, (event) => widgetWindows.close(event.sender));
  ipcMain.handle(IPC.widgetEdgesGet, (event) => widgetWindows.getEdges(event.sender));
  ipcMain.handle(IPC.widgetSlotsShow, (event) => widgetWindows.showSlots(event.sender));
  ipcMain.handle(IPC.widgetSlotsGet, (event) => widgetWindows.getSlots(event.sender));
  ipcMain.handle(IPC.widgetSlotsChoose, (event, slot: unknown) => widgetWindows.chooseSlot(event.sender, slot));
  ipcMain.handle(IPC.usageSummary, () => usageSummary());
  ipcMain.handle(IPC.usageHistory, (_event, offset: unknown = 0) => {
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid history offset.");
    return usageHistory(offset);
  });
  const inFlight = new Map<string, AbortController>();

  ipcMain.on(IPC.chatStart, async (event, payload: ChatStartPayload) => {
    const { requestId, messages, mode } = payload;
    const ac = new AbortController();
    inFlight.set(requestId, ac);
    const sender = event.sender;
    const config = getConfig();
    const delegation = payload.delegation;
    const job = delegation && realtimeSessionBySender.get(sender.id) === delegation.sessionId
      ? delegatedDesktopJob(delegation.sessionId, delegation.toolCallId) : undefined;
    const cancelDelegation = () => ac.abort();
    if (delegation && (!job || job.workerRequestId)) ac.abort();
    else if (job) job.workerRequestId = requestId;
    job?.controller?.signal.addEventListener("abort", cancelDelegation, { once: true });
    if (job?.controller?.signal.aborted) ac.abort();
    const correlation = delegation ? { sessionId: delegation.sessionId, parentCallId: delegation.toolCallId, requestId } : { requestId };
    const taskText = messages.filter(message => message.role === 'user').at(-1)?.content;
    let benchmarkWorker = job ? bindBenchmarkWorker(taskText, ac.signal, () => ac.abort(new Error("Benchmark maximum time limit reached"))) : undefined;
    let benchmarkStarting = false;
    const archiveTools = new Set(["readLocalAgentTask", "openLocalAgentTask", "verifyLocalAgentTaskArchive", "captureScreen", "click", "moveMouse", "pressKeys", "wait"]);
    let desktopStage = job?.archiveTarget ? "I’m waiting for the desktop agent’s next action; the archive is not yet confirmed." : "I’m waiting for the desktop agent’s next action. The task is still running.";
    if (job) job.progress = desktopStage;
    let lastProgress = "";
    let lastBenchmarkMilestone: string | undefined;
    const publishBenchmarkMilestone = () => {
      if (!benchmarkWorker || !job || !delegation || ac.signal.aborted) return;
      job.readProgress = benchmarkWorker.progress;
      const milestone = benchmarkWorker.milestone();
      if (!milestone || milestone === lastBenchmarkMilestone) return;
      lastBenchmarkMilestone = milestone;
      sendRealtimeClientMessage(delegation.sessionId, { type: "research-progress", toolCallId: delegation.toolCallId, text: milestone });
    };
    if (job && benchmarkWorker) job.readProgress = benchmarkWorker.progress;
    const progressTimer = job && delegation ? setInterval(() => {
      if (benchmarkWorker) { job.progress = benchmarkWorker.progress(); publishBenchmarkMilestone(); return; }
      if (desktopStage === lastProgress && !job.archiveTarget) return;
      lastProgress = desktopStage;
      if (!ac.signal.aborted) sendRealtimeClientMessage(delegation.sessionId, { type: "research-progress", toolCallId: delegation.toolCallId, text: desktopStage });
    }, 15000) : undefined;
    // One exact-task archive must not consume minutes of blind exploration.
    const archiveDeadline = job?.archiveTarget ? setTimeout(() => ac.abort(new Error("The archive attempt exceeded its time limit. Its outcome needs verification.")), 75000) : undefined;
    const briefing = mode === "briefing";
    track("command_run", { mode: briefing ? "briefing" : "command" });
    const system = buildSystemPrompt({
      config,
      briefing,
      skillPrompts: briefing ? [] : skillSystemPrompts(config, job?.archiveTarget ? skill => skill.tools.some(tool => archiveTools.has(tool.name)) : undefined),
    });
    const tools = buildToolSet({
      config,
      requestPermission: makePermissionRequester(sender, ac.signal),
      signal: ac.signal,
      ...(job?.archiveTarget ? { includeTool: (tool: { name: string }) => archiveTools.has(tool.name) } : {}),
    });
    try {
      // Resolve the configured provider to a model (may throw for an unset key,
      // an unavailable Apple model, or the not-yet-built subscription). The
      // catch below turns it into a spoken apology.
      ac.signal.throwIfAborted();
      const model = await resolveModel(config);
      const responseMessages = await streamChat({
        messages,
        system,
        model,
        tools,
        briefing,
        archiveTask: Boolean(job?.archiveTarget),
        signal: ac.signal,
        onDelta: (delta) => {
          if (!ac.signal.aborted && !sender.isDestroyed()) {
            sender.send(IPC.chatDelta(requestId), delta);
          }
        },
        onToolCall: (call) => {
          if (call.toolName === 'benchmarkDex') benchmarkStarting = (call.input as { action?: string })?.action === 'start';
          // Tool name only — never the input args.
          if (job?.archiveTarget) desktopStage = call.toolName === "verifyLocalAgentTaskArchive" ? "I’m checking whether Codex actually saved the archive." : call.toolName === "click" ? "I’m working through the task menu; the archive is not yet verified." : "I’m checking the selected task and its visible controls.";
          recordInteraction("tool-call", { ...correlation, tool: call.toolName, callId: call.toolCallId });
          track("tool_used", { tool_name: call.toolName });
          if (!ac.signal.aborted && !sender.isDestroyed()) {
            sender.send(IPC.chatTool(requestId), call);
          }
        },
        onToolResult: (result) => {
          if (result.toolName === 'benchmarkDex' && !benchmarkWorker && (job || benchmarkStarting) && !diagnosticToolOutcome(result.output).failed) benchmarkWorker = bindBenchmarkWorker(taskText, ac.signal, () => ac.abort(new Error("Benchmark maximum time limit reached")));
          if (job && !job.archiveTarget) {
            desktopStage = benchmarkWorker?.progress() ?? desktopProgress(result.toolName, diagnosticToolOutcome(result.output).failed === true);
            job.progress = desktopStage;
            publishBenchmarkMilestone();
          }
          recordInteraction("tool-result", { ...correlation, tool: result.toolName, callId: result.toolCallId, ...diagnosticToolOutcome(result.output) });
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
      clearInterval(progressTimer); clearTimeout(archiveDeadline);
      await benchmarkWorker?.finish().catch(() => {});
      job?.controller?.signal.removeEventListener("abort", cancelDelegation);
      recordInteraction("desktop-worker-ended", { ...correlation, cancelled: ac.signal.aborted });
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

  // Realtime voice sessions --------------------------------------------------
  // The WebSocket + direct tool execution live in main (session-host.ts); the
  // renderer streams mic PCM up and receives audio/transcript/tool notices on
  // the per-session event channel. Tools are permission-wrapped per session so
  // direct calls get the same session-grant semantics as one pipeline command
  // loop ("Allow once" covers the conversation; a new session re-prompts).
  //
  // One live session per window: a new start ends whatever session the same
  // sender still has. Belt-and-braces under the renderer's own connect lock —
  // two concurrent sessions would mean two voices talking over each other.
  const realtimeSessionBySender = new Map<number, string>();
  const realtimeNoticeBuffers = new Map<string, { senderId: number; buffer: RealtimeNoticeBuffer; timer: ReturnType<typeof setTimeout> }>();
  const releaseRealtimeNotices = (sessionId: string) => {
    const entry = realtimeNoticeBuffers.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.buffer.dispose();
    realtimeNoticeBuffers.delete(sessionId);
  };
  ipcMain.on(IPC.realtimeReady, (event, sessionId: string) => {
    const entry = realtimeNoticeBuffers.get(sessionId);
    if (!entry || entry.senderId !== event.sender.id) return;
    clearTimeout(entry.timer);
    entry.buffer.subscribe();
  });
  ipcMain.handle(
    IPC.realtimeStart,
    async (event, opts: { briefing: boolean; wake?: boolean }): Promise<RealtimeStartResult> => {
      const config = getConfig();
      if (config.voice.mode !== "realtime") {
        throw new Error("Realtime voice is not enabled in Settings.");
      }
      const briefing = Boolean(opts?.briefing);
      const modelMeta = getRealtimeModelMeta(config.realtime.model);
      track("realtime_session", { model: config.realtime.model });

      const sender = event.sender;
      const previousSession = realtimeSessionBySender.get(sender.id);
      if (previousSession) {
        endRealtimeSession(previousSession);
        releaseRealtimeNotices(previousSession);
      }
      const screenAbort = new AbortController();
      const screenContext = screenOnWakeEnabled(config, opts?.wake === true)
        ? {
            result: checkScreenHealth(config, AbortSignal.any([
              screenAbort.signal, AbortSignal.timeout(20_000),
            ])),
            cancel: () => screenAbort.abort(),
          }
        : undefined;
      const skillPrompts = directRealtimeSkills(config)
        .map((s) => s.systemPrompt)
        .filter((p): p is string => Boolean(p));
      // Only the direct (non-image) skills are executable in-session; the
      // computer skill is reachable solely through run_task delegation.
      const directIds = new Set(directRealtimeSkills(config).map((s) => s.id));
      const tools = buildToolSet({
        config,
        requestPermission: makePermissionRequester(sender),
        include: (skill) => directIds.has(skill.id),
        includeTool: isDirectTool,
      });
      const toolDefs = buildRealtimeToolDefs(config);
      if (screenContext) {
        // This only reads the already-captured observation. Computer actions
        // remain in the permission-wrapped desktop skill.
        const inputSchema = z.object({});
        tools.read_wake_screen = tool({
          inputSchema,
          execute: async () => ({ observation: await (latestScreenObservation() ?? screenContext.result) }),
        });
        toolDefs.push({
          name: "read_wake_screen",
          description: "Read the screen snapshot taken when this voice session woke up. Waits for its description if still processing. Does not control the computer or capture again.",
          parameters: z.toJSONSchema(inputSchema),
        });
        skillPrompts.push(SCREEN_ON_WAKE_INSTRUCTIONS);
      }

      // Throws user-facing reasons (unset key, failed connection) — the
      // renderer surfaces them as a spoken apology, like resolveModel failures.
      const sessionId = randomUUID();
      const noticeBuffer = new RealtimeNoticeBuffer(notice => {
        if (!sender.isDestroyed()) sender.send(IPC.realtimeEvent(sessionId), notice);
        if (notice.type === "closed") releaseRealtimeNotices(sessionId);
      });
      const noticeTimer = setTimeout(() => {
        releaseRealtimeNotices(sessionId);
        endRealtimeSession(sessionId);
      }, 30_000);
      realtimeNoticeBuffers.set(sessionId, { senderId: sender.id, buffer: noticeBuffer, timer: noticeTimer });
      try {
        await startRealtimeSession({
          provider: config.realtime.provider,
          wakeWord: config.assistant.wakeWord,
          sessionId,
          model: config.realtime.model,
          voice: config.realtime.voice,
          instructions: buildRealtimeInstructions({ config, briefing, skillPrompts }),
          toolDefs,
          tools,
          screenContext,
          transcribesInput: modelMeta?.transcribes ?? true,
          notify: (notice) => {
            if (notice.type === "tool-call") {
              track("tool_used", { tool_name: notice.call.toolName });
            }
            noticeBuffer.push(notice);
          },
        });
      } catch (err) {
        releaseRealtimeNotices(sessionId);
        screenAbort.abort();
        endRealtimeSession(sessionId);
        throw err;
      }
      realtimeSessionBySender.set(sender.id, sessionId);
      sender.once("destroyed", () => {
        releaseRealtimeNotices(sessionId);
        endRealtimeSession(sessionId);
        if (realtimeSessionBySender.get(sender.id) === sessionId) {
          realtimeSessionBySender.delete(sender.id);
        }
      });
      return {
        sessionId,
        greetingPrompt: briefing ? "Give me my briefing." : null,
      };
    },
  );

  ipcMain.on(
    IPC.realtimeClient,
    (_event, sessionId: string, msg: RealtimeClientMessage) => {
      sendRealtimeClientMessage(sessionId, msg);
    },
  );

  ipcMain.on(IPC.realtimeEnd, (_event, sessionId: string) => {
    releaseRealtimeNotices(sessionId);
    endRealtimeSession(sessionId);
  });

  // Config / secrets ---------------------------------------------------------
  ipcMain.handle(IPC.configGet, () => getPublicConfig());

  ipcMain.handle(IPC.configSet, (_event, patch: DeepPartial<OpenDexConfig>) => {
    const result = updateConfig(patch);
    if (patch.llm || patch.computer || patch.skills) clearScreenHealth(getConfig());
    broadcastConfig();
    // Re-bind the global summon shortcut if the user rebound it in Settings.
    if (patch.hotkeys?.summon) registerSummonHotkey();
    return result;
  });

  ipcMain.handle(IPC.secretSet, (_event, name: SecretName, value: string) => {
    const result = setSecret(name, value);
    clearScreenHealth(getConfig());
    broadcastConfig();
    return result;
  });

  ipcMain.handle(IPC.configReset, () => {
    const result = resetConfig();
    clearScreenHealth(getConfig());
    broadcastConfig();
    track("config_reset");
    return result;
  });

  ipcMain.handle(IPC.settingsOpen, (_event, section?: string) => openSettingsWindow(section));
  ipcMain.handle(IPC.settingsSectionGet, () => settingsSection);
  ipcMain.handle(IPC.screenHealthGet, () => getScreenHealth(getConfig()));
  onScreenHealth((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.screenHealthChanged, status);
    }
  });
  ipcMain.handle(IPC.screenHealthRetry, async () => {
    const config = getConfig();
    if (!config.skills.enabled.computer || config.skills.permissions.computer === "never") {
      throw new Error("Enable Control the computer in Skills & tools before checking screen access.");
    }
    const observation = await checkScreenHealth(config);
    for (const sessionId of realtimeSessionBySender.values()) {
      sendRealtimeClientMessage(sessionId, { type: "inject-context", text: `[Screen check requested by the user; context only, do not reply]\n${observation}` });
    }
    return getScreenHealth(getConfig());
  });
  ipcMain.handle(IPC.screenHealthFix, async (_event, action: string) => {
    if (action === "billing") {
      const url = screenBillingUrl(getConfig().llm.provider);
      if (url) await shell.openExternal(url);
    } else if (action === "permission" && process.platform === "darwin") {
      await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    } else if (action === "model") openSettingsWindow("model");
    else throw new Error("This recovery action is unavailable.");
  });

  ipcMain.handle(IPC.onboardingComplete, () => {
    const result = completeOnboarding();
    broadcastConfig();
    // Coarse, anonymized snapshot of which options the user chose — feature
    // popularity only, no content or identifiers.
    const c = result.config;
    track("onboarding_completed", {
      theme: c.appearance.theme,
      voice_mode: c.voice.mode,
      ...(c.voice.mode === "realtime" ? { realtime_model: c.realtime.model } : {}),
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

  // Small, ephemeral meter samples bypass transcript snapshots and diagnostics.
  ipcMain.on(IPC.microphoneLevel, (event, level: unknown) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (level !== null && (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1)) return;
    if (notchWindow && !notchWindow.isDestroyed()) {
      notchWindow.webContents.send(IPC.microphoneLevel, level);
    }
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
  const icon = createTrayIcon();
  try {
    tray = new Tray(icon);
  } catch (err) {
    console.error("[opendex] failed to create tray", err);
    return;
  }
  tray.setToolTip("OpenDex");
  updateTrayMenu();
  tray.on("click", () => summonWindow());
}

function updateTrayMenu() {
  if (!tray) return;
  const recording = recordingActive();
  tray.setTitle(recording ? "● REC" : "");
  tray.setToolTip(recording ? "OpenDex is recording" : "OpenDex");
  const menu = Menu.buildFromTemplate([
    { label: "Show OpenDex", click: () => summonWindow({ toggle: false }) },
    { label: "Show floating widgets", click: () => widgetWindows.show() },
    { type: "separator" },
    { label: "Settings…", click: () => openSettingsWindow() },
    { label: "Recordings…", click: () => openSettingsWindow("recordings") },
    ...(recording ? [{ label: "Stop recording", click: () => stopRecording() }] : []),
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
}

// A Desktop launcher must pass app arguments even if an unrelated Electron
// window exists. Repeated launches summon Dex instead of opening another mic.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => {
  if (app.isReady()) summonWindow({ toggle: false });
});

app.whenReady().then(() => {
  if (!primaryInstance) return;
  configureInteractionLog(join(app.getPath("userData"), "diagnostics"));
  let usageUpdate: ReturnType<typeof setTimeout> | undefined;
  initUsage(join(app.getPath("userData"), "usage"), () => {
    if (usageUpdate) return;
    usageUpdate = setTimeout(() => {
      usageUpdate = undefined;
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(IPC.usageChanged);
    }, 250);
  });
  initConfig();
  initAnalytics();
  track("app_started");
  if (!getConfig().onboarding.completed) track("onboarding_started");
  registerIpc();
  initRecordings(() => settingsWindow, () => {
    updateTrayMenu();
    if (recordingQuitPending && getRecordingState().phase === "idle") app.quit();
  }, () => openSettingsWindow(undefined, true));
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

app.on("before-quit", event => {
  if (recordingActive() && !recordingQuitPending) {
    event.preventDefault();
    recordingQuitPending = true;
    stopRecording();
    setTimeout(() => app.quit(), 8000).unref();
    return;
  }
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
