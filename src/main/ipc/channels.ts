// Shared IPC channel names + payload types. Imported by both the main process
// (handlers) and the preload bridge so the contract stays in one place.

import type { ChatMessage } from "../agent/chat";

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
  getPicovoiceKey: "stt:picovoice-key",
  // main → renderer event: global push-to-talk hotkey pressed
  pushToTalk: "push-to-talk",
  // main → renderer event: global emergency-stop hotkey pressed
  interrupt: "interrupt",
  // Permission gate: main → renderer prompt, renderer → main answer
  permissionRequest: "permission:request",
  permissionRespond: "permission:respond",
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

export interface PermissionRequestPayload {
  id: string;
  skillId: string;
  label: string;
  detail: string;
}

export type { ChatMessage };
