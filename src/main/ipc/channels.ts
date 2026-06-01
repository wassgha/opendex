// Shared IPC channel names + payload types. Imported by both the main process
// (handlers) and the preload bridge so the contract stays in one place.

import type { ChatMessage } from "../agent/chat";

export const IPC = {
  chatStart: "chat:start",
  chatCancel: "chat:cancel",
  // Per-request reply channels are suffixed with the requestId:
  //   chat:delta:<id> · chat:done:<id> · chat:error:<id>
  chatDelta: (id: string) => `chat:delta:${id}`,
  chatDone: (id: string) => `chat:done:${id}`,
  chatError: (id: string) => `chat:error:${id}`,
  ttsSynthesize: "tts:synthesize",
} as const;

export interface ChatStartPayload {
  requestId: string;
  messages: ChatMessage[];
  mode?: "briefing";
}

export type { ChatMessage };
