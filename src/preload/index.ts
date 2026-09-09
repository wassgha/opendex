import type { UsageSummary, UsageHistory } from "../main/usage/types";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { RecordingEntry, RecordingOptions, RecordingSource, RecordingState } from "../main/recordings/types";
import {
  IPC,
  type ChatMessage,
  type PermissionRequestPayload,
  type RealtimeClientMessage,
  type RealtimeServerNotice,
  type RealtimeStartResult,
  type SessionState,
  type ToolCallEvent,
  type ToolResultEvent,
  type UpdateStatusPayload,
  type ViewCommand,
  type WindowMode,
} from "../main/ipc/channels";
import type { ScreenHealth } from "../main/config/screen-health";
import type { PermissionDecision } from "../main/agent/permissions";
import type {
  DeepPartial,
  OpenDexConfig,
  PublicConfig,
  SecretName,
  SttProvider,
} from "../main/config/schema";

export interface ChatRequest {
  messages: ChatMessage[];
  mode?: "briefing";
  delegation?: { sessionId: string; toolCallId: string };
  onDelta: (text: string) => void;
  /** Fired when the agent invokes a tool (for the activity UI). */
  onToolCall?: (call: ToolCallEvent) => void;
  /** Fired when a tool returns (for result cards). */
  onToolResult?: (result: ToolResultEvent) => void;
}

export interface ChatHandle {
  cancel: () => void;
  /** Resolves with the assistant/tool messages generated this turn (for history). */
  done: Promise<ChatMessage[]>;
}

const opendex = {
  openWidgets: (): Promise<void> => ipcRenderer.invoke(IPC.widgetsOpen),
  usageSummary: (): Promise<UsageSummary> => ipcRenderer.invoke(IPC.usageSummary),
  usageHistory: (offset = 0): Promise<UsageHistory> => ipcRenderer.invoke(IPC.usageHistory, offset),
  onUsageChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.usageChanged, listener);
    return () => { ipcRenderer.removeListener(IPC.usageChanged, listener); };
  },
  recordingControl: (action: "start" | "stop"): Promise<RecordingState> => ipcRenderer.invoke(IPC.recordingControl, action),
  recordingReady: () => ipcRenderer.send(IPC.recordingReady),
  recordingStartResult: (id: string, error?: string) => ipcRenderer.send(IPC.recordingStartResult, id, error),
  onRecordingStart: (callback: (id: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on(IPC.recordingStartRequested, listener);
    return () => { ipcRenderer.removeListener(IPC.recordingStartRequested, listener); };
  },
  recordingSources: (): Promise<RecordingSource[]> => ipcRenderer.invoke(IPC.recordingSources),
  recordingPrepare: (options: RecordingOptions, mime: string): Promise<string> => ipcRenderer.invoke(IPC.recordingPrepare, options, mime),
  recordingStarted: (id: string): Promise<void> => ipcRenderer.invoke(IPC.recordingStarted, id),
  recordingChunk: (id: string, bytes: ArrayBuffer): Promise<void> => ipcRenderer.invoke(IPC.recordingChunk, id, bytes),
  recordingFinish: (id: string, duration: number, error?: string): Promise<void> => ipcRenderer.invoke(IPC.recordingFinish, id, duration, error),
  recordingState: (): Promise<RecordingState> => ipcRenderer.invoke(IPC.recordingState),
  recordingStop: (): Promise<void> => ipcRenderer.invoke(IPC.recordingStop),
  recordingList: (): Promise<RecordingEntry[]> => ipcRenderer.invoke(IPC.recordingList),
  recordingExport: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.recordingExport, id),
  recordingTrash: (id: string): Promise<void> => ipcRenderer.invoke(IPC.recordingTrash, id),
  recordingReveal: (id: string): Promise<void> => ipcRenderer.invoke(IPC.recordingReveal, id),
  onRecordingState: (callback: (state: RecordingState) => void) => {
    const listener = (_event: IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(IPC.recordingChanged, listener);
    return () => { ipcRenderer.removeListener(IPC.recordingChanged, listener); };
  },
  onRecordingStop: (callback: () => void) => {
    ipcRenderer.on(IPC.recordingStopRequested, callback);
    return () => { ipcRenderer.removeListener(IPC.recordingStopRequested, callback); };
  },
  /** The host OS platform (e.g. "darwin"), so the renderer can adapt its chrome
   *  to the frameless title bar (traffic-light clearance, drag regions). */
  platform: process.platform as NodeJS.Platform,

  /**
   * Stream a chat reply. Text deltas arrive via `onDelta`; the returned promise
   * resolves with the generated messages (or rejects on error). `cancel()`
   * aborts the main-process stream (used for barge-in / stop).
   */
  chat({ messages, mode, delegation, onDelta, onToolCall, onToolResult }: ChatRequest): ChatHandle {
    const requestId = randomUUID();
    const deltaCh = IPC.chatDelta(requestId);
    const toolCh = IPC.chatTool(requestId);
    const toolResultCh = IPC.chatToolResult(requestId);
    const doneCh = IPC.chatDone(requestId);
    const errorCh = IPC.chatError(requestId);

    let settled = false;
    let resolveDone!: (msgs: ChatMessage[]) => void;
    let rejectDone!: (err: Error) => void;
    const done = new Promise<ChatMessage[]>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    const onDeltaEvt = (_e: IpcRendererEvent, text: string) => onDelta(text);
    const onToolEvt = (_e: IpcRendererEvent, call: ToolCallEvent) =>
      onToolCall?.(call);
    const onToolResultEvt = (_e: IpcRendererEvent, result: ToolResultEvent) =>
      onToolResult?.(result);
    const onDoneEvt = (_e: IpcRendererEvent, msgs: ChatMessage[]) =>
      finish(null, msgs);
    const onErrorEvt = (_e: IpcRendererEvent, message: string) =>
      finish(new Error(message));

    function finish(err: Error | null, msgs: ChatMessage[] = []) {
      if (settled) return;
      settled = true;
      ipcRenderer.removeListener(deltaCh, onDeltaEvt);
      ipcRenderer.removeListener(toolCh, onToolEvt);
      ipcRenderer.removeListener(toolResultCh, onToolResultEvt);
      ipcRenderer.removeListener(doneCh, onDoneEvt);
      ipcRenderer.removeListener(errorCh, onErrorEvt);
      if (err) rejectDone(err);
      else resolveDone(msgs);
    }

    ipcRenderer.on(deltaCh, onDeltaEvt);
    ipcRenderer.on(toolCh, onToolEvt);
    ipcRenderer.on(toolResultCh, onToolResultEvt);
    ipcRenderer.once(doneCh, onDoneEvt);
    ipcRenderer.once(errorCh, onErrorEvt);
    ipcRenderer.send(IPC.chatStart, { requestId, messages, mode, delegation });

    return {
      cancel: () => {
        if (settled) return;
        ipcRenderer.send(IPC.chatCancel, requestId);
        finish(null);
      },
      done,
    };
  },

  /** Synthesise a sentence to MP3 bytes for playback in the renderer. */
  async synthesize(text: string): Promise<ArrayBuffer> {
    return ipcRenderer.invoke(IPC.ttsSynthesize, text);
  },

  // ── Realtime voice sessions ───────────────────────────────────────────────
  // The WebSocket and provider credentials live in main;
  // the renderer streams mic PCM up and plays the audio notices coming back.

  /** Open a realtime session in main. `briefing` opens it with the proactive
   *  greeting. Rejects with a user-facing reason (unset key, failed connect). */
  realtimeStart(opts: { briefing: boolean; wake?: boolean }): Promise<RealtimeStartResult> {
    return ipcRenderer.invoke(IPC.realtimeStart, opts);
  },

  /** Drive an open session: mic audio frames, typed text, task-progress
   *  context, run_task results, response control. */
  realtimeSend(sessionId: string, msg: RealtimeClientMessage): void {
    ipcRenderer.send(IPC.realtimeClient, sessionId, msg);
  },

  /** Subscribe to a session's notices (audio, transcripts, tool calls,
   *  disconnect). Returns an unsubscribe fn. */
  onRealtimeEvent(
    sessionId: string,
    handler: (notice: RealtimeServerNotice) => void,
  ): () => void {
    const channel = IPC.realtimeEvent(sessionId);
    const listener = (_e: IpcRendererEvent, notice: RealtimeServerNotice) =>
      handler(notice);
    ipcRenderer.on(channel, listener);
    ipcRenderer.send(IPC.realtimeReady, sessionId);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /** Close a session (idle disconnect, mute, mode switch). Safe to call twice. */
  realtimeEnd(sessionId: string): void {
    ipcRenderer.send(IPC.realtimeEnd, sessionId);
  },

  /** Read the full (non-secret) config plus which secrets are present. */
  getConfig(): Promise<PublicConfig> {
    return ipcRenderer.invoke(IPC.configGet);
  },

  /** Patch non-secret config; returns the updated public config. */
  setConfig(patch: DeepPartial<OpenDexConfig>): Promise<PublicConfig> {
    return ipcRenderer.invoke(IPC.configSet, patch);
  },

  /** Store (or clear, if empty) an API key. Values never come back out. */
  setSecret(name: SecretName, value: string): Promise<PublicConfig> {
    return ipcRenderer.invoke(IPC.secretSet, name, value);
  },

  /** Mark first-run onboarding complete. */
  completeOnboarding(): Promise<PublicConfig> {
    return ipcRenderer.invoke(IPC.onboardingComplete);
  },

  /** Factory reset: wipe stored prefs + secrets and re-run onboarding. */
  resetConfig(): Promise<PublicConfig> {
    return ipcRenderer.invoke(IPC.configReset);
  },

  /** Open the dedicated settings window (creates it, or focuses if already open). */
  openSettings(section?: string): Promise<void> {
    return ipcRenderer.invoke(IPC.settingsOpen, section);
  },
  getSettingsSection(): Promise<string> { return ipcRenderer.invoke(IPC.settingsSectionGet); },
  onSettingsNavigate(handler: (section: string) => void): () => void {
    const listener = (_event: IpcRendererEvent, section: string) => handler(section);
    ipcRenderer.on(IPC.settingsNavigate, listener);
    return () => ipcRenderer.removeListener(IPC.settingsNavigate, listener);
  },
  getScreenHealth(): Promise<ScreenHealth> { return ipcRenderer.invoke(IPC.screenHealthGet); },
  retryScreen(): Promise<ScreenHealth> { return ipcRenderer.invoke(IPC.screenHealthRetry); },
  fixScreen(action: "billing" | "permission" | "model"): Promise<void> { return ipcRenderer.invoke(IPC.screenHealthFix, action); },
  onScreenHealth(handler: (status: ScreenHealth) => void): () => void {
    const listener = (_event: IpcRendererEvent, status: ScreenHealth) => handler(status);
    ipcRenderer.on(IPC.screenHealthChanged, listener);
    return () => ipcRenderer.removeListener(IPC.screenHealthChanged, listener);
  },

  /** Subscribe to config changes broadcast from the main process (so windows
   *  stay in sync when either one edits config). Returns an unsubscribe fn. */
  onConfigChanged(handler: (config: PublicConfig) => void): () => void {
    const listener = (_e: IpcRendererEvent, config: PublicConfig) =>
      handler(config);
    ipcRenderer.on(IPC.configChanged, listener);
    return () => ipcRenderer.removeListener(IPC.configChanged, listener);
  },

  /** Transcribe a captured utterance (WAV bytes) via a cloud STT provider. */
  transcribe(provider: SttProvider, wav: ArrayBuffer): Promise<string> {
    return ipcRenderer.invoke(IPC.transcribe, provider, wav);
  },

  /** Probe whether the Apple on-device model can run (provider picker gate). */
  appleAvailability(): Promise<{ available: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC.llmAppleAvailability);
  },

  /** Subscribe to the global push-to-talk hotkey. Returns an unsubscribe fn. */
  onPushToTalk(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on(IPC.pushToTalk, listener);
    return () => ipcRenderer.removeListener(IPC.pushToTalk, listener);
  },

  /** Subscribe to the global emergency-stop hotkey. Returns an unsubscribe fn. */
  onInterrupt(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on(IPC.interrupt, listener);
    return () => ipcRenderer.removeListener(IPC.interrupt, listener);
  },

  // ── Session state relay (main window → view surfaces) ─────────────────────

  publishMicrophoneLevel(level: number | null): void {
    ipcRenderer.send(IPC.microphoneLevel, level);
  },
  onMicrophoneLevel(handler: (level: number | null) => void): () => void {
    const listener = (_e: IpcRendererEvent, level: number | null) => handler(level);
    ipcRenderer.on(IPC.microphoneLevel, listener);
    return () => ipcRenderer.removeListener(IPC.microphoneLevel, listener);
  },

  /** Main window: publish a fresh snapshot of the live voice session. */
  publishSessionState(state: SessionState): void {
    ipcRenderer.send(IPC.sessionUpdate, state);
  },

  /** View surfaces (overlay/notch): subscribe to session-state snapshots. The
   *  handler fires immediately with the last-known state on (re)subscribe. */
  onSessionState(handler: (state: SessionState) => void): () => void {
    const listener = (_e: IpcRendererEvent, state: SessionState) => handler(state);
    ipcRenderer.on(IPC.sessionChanged, listener);
    return () => ipcRenderer.removeListener(IPC.sessionChanged, listener);
  },

  // ── Window mode + summon ──────────────────────────────────────────────────

  /** Request a window layout (full themed experience ↔ slim notch bar). */
  setWindowMode(mode: WindowMode): void {
    ipcRenderer.send(IPC.windowSetMode, mode);
  },

  /** Notch only: set the notch window size (px) — the renderer measures its own
   *  content and drives width + height (compact at rest, wider/taller for a
   *  caption, type field, or result card). */
  setNotchSize(width: number, height: number): void {
    ipcRenderer.send(IPC.notchSetSize, { width, height });
  },

  /** Notch only: give the notch window OS keyboard focus so its type field can
   *  receive keystrokes (it's shown unfocused via showInactive). */
  focusNotch(): void {
    ipcRenderer.send(IPC.notchFocus);
  },

  /** Subscribe to window-mode changes applied by main. Returns an unsubscribe fn. */
  onWindowMode(handler: (mode: WindowMode) => void): () => void {
    const listener = (_e: IpcRendererEvent, mode: WindowMode) => handler(mode);
    ipcRenderer.on(IPC.windowMode, listener);
    return () => ipcRenderer.removeListener(IPC.windowMode, listener);
  },

  /** View-only surface (notch) → run a session action on the main window. */
  sendViewCommand(cmd: ViewCommand): void {
    ipcRenderer.send(IPC.viewCommand, cmd);
  },

  /** Main window: receive a relayed session action (submitText / toggleMute). */
  onRemoteCommand(handler: (cmd: ViewCommand) => void): () => void {
    const listener = (_e: IpcRendererEvent, cmd: ViewCommand) => handler(cmd);
    ipcRenderer.on(IPC.remoteCommand, listener);
    return () => ipcRenderer.removeListener(IPC.remoteCommand, listener);
  },

  /** Subscribe to the summon hotkey bringing the window forward (focus input). */
  onSummoned(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on(IPC.windowSummoned, listener);
    return () => ipcRenderer.removeListener(IPC.windowSummoned, listener);
  },

  // ── Overlay HUD ───────────────────────────────────────────────────────────

  /** Overlay: toggle click-through so the Stop button is clickable on hover. */
  setOverlayInteractive(interactive: boolean): void {
    ipcRenderer.send(IPC.overlaySetInteractive, interactive);
  },

  /** Overlay: trigger the emergency stop (relayed to the main window). */
  overlayInterrupt(): void {
    ipcRenderer.send(IPC.overlayInterrupt);
  },

  /** Subscribe to permission prompts for sensitive tool calls. */
  onPermissionRequest(
    handler: (req: PermissionRequestPayload) => void,
  ): () => void {
    const listener = (_e: IpcRendererEvent, req: PermissionRequestPayload) =>
      handler(req);
    ipcRenderer.on(IPC.permissionRequest, listener);
    return () => ipcRenderer.removeListener(IPC.permissionRequest, listener);
  },

  /** Subscribe to prompt dismissals (a prompt settled without an answer). */
  onPermissionDismiss(handler: (id: string) => void): () => void {
    const listener = (_e: IpcRendererEvent, id: string) => handler(id);
    ipcRenderer.on(IPC.permissionDismiss, listener);
    return () => ipcRenderer.removeListener(IPC.permissionDismiss, listener);
  },

  /** Subscribe to auto-update lifecycle events (download progress, errors,
   *  ready-to-install). Returns an unsubscribe fn. */
  onUpdateStatus(handler: (status: UpdateStatusPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, status: UpdateStatusPayload) =>
      handler(status);
    ipcRenderer.on(IPC.updateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener);
  },

  /** Answer a permission prompt. */
  respondPermission(
    id: string,
    skillId: string,
    decision: PermissionDecision,
  ): void {
    ipcRenderer.send(IPC.permissionRespond, { id, skillId, decision });
  },
};

export type OpenDexApi = typeof opendex;

contextBridge.exposeInMainWorld("opendex", opendex);
