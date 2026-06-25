// Shared IPC channel names + payload types. Imported by both the main process
// (handlers) and the preload bridge so the contract stays in one place.

import type { ChatMessage } from "../agent/chat";
import type { WindowMode } from "../config/schema";

export const IPC = {
  chatStart: "chat:start",
  chatCancel: "chat:cancel",
  // Per-request reply channels are suffixed with the requestId:
  //   chat:delta:<id> · chat:done:<id> · chat:error:<id>
  chatDelta: (id: string) => `chat:delta:${id}`,
  chatTool: (id: string) => `chat:tool:${id}`,
  chatDone: (id: string) => `chat:done:${id}`,
  chatError: (id: string) => `chat:error:${id}`,
  ttsSynthesize: "tts:synthesize",
  // Config
  configGet: "config:get",
  configSet: "config:set",
  secretSet: "secret:set",
  configReset: "config:reset",
  onboardingComplete: "onboarding:complete",
  // main → renderer event: config changed (broadcast to all windows)
  configChanged: "config:changed",
  // renderer → main: open the dedicated settings window
  settingsOpen: "settings:open",
  // STT
  transcribe: "stt:transcribe",
  // LLM: probe Apple on-device model availability (for the provider picker)
  llmAppleAvailability: "llm:apple-availability",
  // main → renderer event: global push-to-talk hotkey pressed
  pushToTalk: "push-to-talk",
  // main → renderer event: global emergency-stop hotkey pressed
  interrupt: "interrupt",
  // Session-state relay: the main window pushes a snapshot of the live voice
  // session (what the assistant is doing right now) to main, which re-broadcasts
  // it to the overlay HUD and any other view-only surface.
  sessionUpdate: "session:update",
  sessionChanged: "session:changed",
  // Window mode (full ↔ notch) + Spotlight-style summon:
  // renderer → main: request a window mode; main → renderer: mode applied
  windowSetMode: "window:set-mode",
  windowMode: "window:mode",
  // main → renderer event: the summon hotkey brought the window forward
  windowSummoned: "window:summoned",
  // Overlay HUD: renderer → main, toggle click-through so the Stop button is
  // clickable while the rest of the overlay stays pass-through.
  overlaySetInteractive: "overlay:set-interactive",
  // Overlay HUD → main: emergency stop pressed in the floating HUD (relayed to
  // the main window's interrupt path).
  overlayInterrupt: "overlay:interrupt",
  // Permission gate: main → permission popup prompt, popup → main answer.
  // `permissionDismiss` tells the popup to drop a prompt that settled without an
  // answer (timed out, or the requesting window died).
  permissionRequest: "permission:request",
  permissionRespond: "permission:respond",
  permissionDismiss: "permission:dismiss",
  // main → renderer event: auto-update lifecycle (download progress, errors)
  updateStatus: "update:status",
} as const;

export interface UpdateStatusPayload {
  /**
   * `available` → an update was found and is downloading; `downloading` carries
   * `percent`; `downloaded` → ready to install (a restart dialog also fires);
   * `error` carries `message`. `checking`/`up-to-date` are not emitted (they'd
   * be hourly noise) — the renderer only surfaces an active download or failure.
   */
  state: "available" | "downloading" | "downloaded" | "error";
  version?: string;
  /** 0..100, present while `state === "downloading"`. */
  percent?: number;
  /** Human-readable failure reason, present while `state === "error"`. */
  message?: string;
}

export interface ChatStartPayload {
  requestId: string;
  messages: ChatMessage[];
  mode?: "briefing";
}

export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** One transient action hint (mirrors the renderer's `ToolActivity`). */
export interface SessionActivity {
  id: string;
  icon: string;
  label: string;
}

/**
 * A snapshot of the live voice session, broadcast from the main window to
 * view-only surfaces (overlay HUD, notch). `status` is the renderer's
 * `DexStatus` as a string (kept loose here to avoid coupling the shared IPC
 * layer to a renderer type).
 */
export interface SessionState {
  status: string;
  muted: boolean;
  activity: SessionActivity[];
  liveCaption: string;
  spokenCaption: string;
}

export type { WindowMode };

export interface PermissionRequestPayload {
  id: string;
  skillId: string;
  label: string;
  detail: string;
}

export type { ChatMessage };
