import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { randomUUID } from "node:crypto";
import {
  IPC,
  type ChatMessage,
  type PermissionRequestPayload,
  type SessionState,
  type ToolCallEvent,
  type UpdateStatusPayload,
  type ViewCommand,
  type WindowMode,
} from "../main/ipc/channels";
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
  onDelta: (text: string) => void;
  /** Fired when the agent invokes a tool (for the activity UI). */
  onToolCall?: (call: ToolCallEvent) => void;
}

export interface ChatHandle {
  cancel: () => void;
  /** Resolves with the assistant/tool messages generated this turn (for history). */
  done: Promise<ChatMessage[]>;
}

const opendex = {
  /** The host OS platform (e.g. "darwin"), so the renderer can adapt its chrome
   *  to the frameless title bar (traffic-light clearance, drag regions). */
  platform: process.platform as NodeJS.Platform,

  /**
   * Stream a chat reply. Text deltas arrive via `onDelta`; the returned promise
   * resolves with the generated messages (or rejects on error). `cancel()`
   * aborts the main-process stream (used for barge-in / stop).
   */
  chat({ messages, mode, onDelta, onToolCall }: ChatRequest): ChatHandle {
    const requestId = randomUUID();
    const deltaCh = IPC.chatDelta(requestId);
    const toolCh = IPC.chatTool(requestId);
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
    const onDoneEvt = (_e: IpcRendererEvent, msgs: ChatMessage[]) =>
      finish(null, msgs);
    const onErrorEvt = (_e: IpcRendererEvent, message: string) =>
      finish(new Error(message));

    function finish(err: Error | null, msgs: ChatMessage[] = []) {
      if (settled) return;
      settled = true;
      ipcRenderer.removeListener(deltaCh, onDeltaEvt);
      ipcRenderer.removeListener(toolCh, onToolEvt);
      ipcRenderer.removeListener(doneCh, onDoneEvt);
      ipcRenderer.removeListener(errorCh, onErrorEvt);
      if (err) rejectDone(err);
      else resolveDone(msgs);
    }

    ipcRenderer.on(deltaCh, onDeltaEvt);
    ipcRenderer.on(toolCh, onToolEvt);
    ipcRenderer.once(doneCh, onDoneEvt);
    ipcRenderer.once(errorCh, onErrorEvt);
    ipcRenderer.send(IPC.chatStart, { requestId, messages, mode });

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
  openSettings(): Promise<void> {
    return ipcRenderer.invoke(IPC.settingsOpen);
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
