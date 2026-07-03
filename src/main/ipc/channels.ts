// Shared IPC channel names + payload types. Imported by both the main process
// (handlers) and the preload bridge so the contract stays in one place.

import type { ChatMessage } from "../agent/chat";
import type { WindowMode } from "../config/schema";

export const IPC = {
  chatStart: "chat:start",
  chatCancel: "chat:cancel",
  // Per-request reply channels are suffixed with the requestId:
  //   chat:delta:<id> · chat:tool:<id> · chat:tool-result:<id> · chat:done:<id> · chat:error:<id>
  chatDelta: (id: string) => `chat:delta:${id}`,
  chatTool: (id: string) => `chat:tool:${id}`,
  chatToolResult: (id: string) => `chat:tool-result:${id}`,
  chatDone: (id: string) => `chat:done:${id}`,
  chatError: (id: string) => `chat:error:${id}`,
  ttsSynthesize: "tts:synthesize",
  // Realtime voice sessions (speech-to-speech). The WebSocket lives in MAIN —
  // the gateway authenticates the upgrade with the raw AI_GATEWAY_API_KEY (no
  // ephemeral secret is minted), so the renderer can never host the socket
  // without seeing the key. The renderer owns only the audio I/O: it streams
  // mic PCM frames up via `realtimeClient` and receives audio + transcript +
  // tool notices back on the per-session `realtime:event:<id>` channel.
  realtimeStart: "realtime:start",
  realtimeClient: "realtime:client",
  realtimeEvent: (id: string) => `realtime:event:${id}`,
  realtimeEnd: "realtime:end",
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
  // A view-only surface (the notch window) asks main to run a session action;
  // main relays it to the main window which owns the voice session.
  viewCommand: "view:command",
  // main → main window: a relayed command to execute against `useDex`.
  remoteCommand: "remote:command",
  // main → renderer event: the summon hotkey brought the window forward
  windowSummoned: "window:summoned",
  // notch renderer → main: set the notch window size (px). The renderer measures
  // its own content and drives both width and height — compact at rest, wider for
  // a caption, taller for the type field or a tool-result card. Main keeps it
  // centered on the top edge.
  notchSetSize: "notch:set-size",
  // notch renderer → main: give the notch window OS keyboard focus (it's shown
  // with showInactive, so typing needs an explicit focus first).
  notchFocus: "notch:focus",
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

/** A tool's result, streamed to the renderer so it can render a result card.
 *  Image-bearing outputs (computer-use screenshots) are stripped to a small
 *  placeholder before they reach this channel — see the chatStart handler. */
export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

/** One transient action hint (mirrors the renderer's `ToolActivity`). */
export interface SessionActivity {
  id: string;
  icon: string;
  label: string;
}

/** A tool call + result, relayed so view-only surfaces (notch) can render the
 *  result card. Structurally matches the renderer's `ToolInvocation`. */
export interface SessionToolInvocation {
  id: string;
  name: string;
  input: unknown;
  result: unknown;
  status: "running" | "done" | "error";
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
  /** Tool calls + results this turn — view surfaces render the latest as a card. */
  toolInvocations: SessionToolInvocation[];
  /** The user's in-progress transcription (while listening). */
  liveCaption: string;
  /** Assistant text spoken so far this turn (TTS-synced; lags the stream). */
  spokenCaption: string;
  /** The assistant's full streamed reply for the current turn (what the main
   *  window shows live) — so view surfaces stay in sync with it, not the
   *  speech-lagged caption. */
  reply: string;
}

export type { WindowMode };

/** A session action requested by a view-only surface (notch) and relayed to the
 *  main window (which owns `useDex`). */
export type ViewCommand =
  | { type: "submitText"; text: string }
  | { type: "toggleMute" }
  | { type: "newConversation" }
  | { type: "expand" };

/** The delegation tool a realtime session uses to hand a task to the pipeline
 *  agent (full toolset incl. computer-use). Declared here — the shared IPC
 *  contract — because main defines it and the renderer executes it. */
export const RUN_TASK_TOOL = "run_task";

export interface RealtimeStartResult {
  sessionId: string;
  /** The first user message to send when this session opens with the proactive
   *  greeting, else null. */
  greetingPrompt: string | null;
}

/** Renderer → main: drive an open realtime session. `audio` chunks are 24kHz
 *  mono PCM16 mic frames. `tool-result` answers a delegated run_task call.
 *  `inject-context` adds a conversation item without requesting a response
 *  (task-progress narration feed); `request-response` asks the model to speak. */
export type RealtimeClientMessage =
  | { type: "audio"; chunk: ArrayBuffer }
  | { type: "user-text"; text: string }
  | { type: "inject-context"; text: string }
  | { type: "request-response" }
  | { type: "tool-result"; toolCallId: string; name: string; output: unknown }
  | { type: "cancel-response" };

/** Main → renderer: everything the session surfaces. `audio` chunks are 24kHz
 *  mono PCM16 of the model's voice. `run-task` asks the renderer to drive a
 *  delegated pipeline command (it answers with a `tool-result` client message).
 *  `error` is informational (server-side event, usually non-fatal); a dead
 *  session always arrives as `closed`. */
export type RealtimeServerNotice =
  | { type: "open" }
  | { type: "audio"; chunk: ArrayBuffer }
  | { type: "speech-started" }
  | { type: "speech-stopped" }
  | { type: "user-transcript"; text: string }
  | { type: "assistant-delta"; text: string }
  | { type: "turn-done" }
  | { type: "tool-call"; call: ToolCallEvent }
  | { type: "tool-result"; result: ToolResultEvent }
  | { type: "run-task"; toolCallId: string; task: string }
  | { type: "error"; message: string }
  | { type: "closed"; reason: "server" | "error" | "ended" };

export interface PermissionRequestPayload {
  id: string;
  skillId: string;
  label: string;
  detail: string;
}

export type { ChatMessage };
