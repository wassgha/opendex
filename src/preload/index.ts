import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { randomUUID } from "node:crypto";
import {
  IPC,
  type ChatMessage,
  type PermissionRequestPayload,
  type ToolCallEvent,
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

  /** Read the Picovoice AccessKey (the one secret the renderer may read — the
   *  Porcupine WASM SDK requires it client-side). */
  getPicovoiceKey(): Promise<string> {
    return ipcRenderer.invoke(IPC.getPicovoiceKey);
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

  /** Subscribe to permission prompts for sensitive tool calls. */
  onPermissionRequest(
    handler: (req: PermissionRequestPayload) => void,
  ): () => void {
    const listener = (_e: IpcRendererEvent, req: PermissionRequestPayload) =>
      handler(req);
    ipcRenderer.on(IPC.permissionRequest, listener);
    return () => ipcRenderer.removeListener(IPC.permissionRequest, listener);
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
