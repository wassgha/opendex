import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { randomUUID } from "node:crypto";
import { IPC, type ChatMessage } from "../main/ipc/channels";

export interface ChatRequest {
  messages: ChatMessage[];
  mode?: "briefing";
  onDelta: (text: string) => void;
}

export interface ChatHandle {
  cancel: () => void;
  done: Promise<void>;
}

const opendex = {
  /**
   * Stream a chat reply. Text deltas arrive via `onDelta`; the returned promise
   * resolves when the reply completes (or rejects on error). `cancel()` aborts
   * the main-process stream (used for barge-in / stop).
   */
  chat({ messages, mode, onDelta }: ChatRequest): ChatHandle {
    const requestId = randomUUID();
    const deltaCh = IPC.chatDelta(requestId);
    const doneCh = IPC.chatDone(requestId);
    const errorCh = IPC.chatError(requestId);

    let settled = false;
    let resolveDone!: () => void;
    let rejectDone!: (err: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    const onDeltaEvt = (_e: IpcRendererEvent, text: string) => onDelta(text);
    const onDoneEvt = () => finish(null);
    const onErrorEvt = (_e: IpcRendererEvent, message: string) =>
      finish(new Error(message));

    function finish(err: Error | null) {
      if (settled) return;
      settled = true;
      ipcRenderer.removeListener(deltaCh, onDeltaEvt);
      ipcRenderer.removeListener(doneCh, onDoneEvt);
      ipcRenderer.removeListener(errorCh, onErrorEvt);
      if (err) rejectDone(err);
      else resolveDone();
    }

    ipcRenderer.on(deltaCh, onDeltaEvt);
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
};

export type OpenDexApi = typeof opendex;

contextBridge.exposeInMainWorld("opendex", opendex);
