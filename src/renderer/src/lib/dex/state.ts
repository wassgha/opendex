export type DexStatus =
  | "idle" // very brief — before auto-engage fires
  | "listening_wake" // continuous recognition waiting for the wake word
  | "active_listening" // captured wake word, listening for command
  | "follow_up_listening" // listening for a follow-up turn after a reply
  | "thinking" // querying the agent
  | "speaking" // audio playing
  | "muted" // wake-word loop paused
  | "error" // unrecoverable error
  | "unsupported"; // browser doesn't support SpeechRecognition

export interface TranscriptTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Keep the latest input available even as assistant turns stream after it. */
export function inputTranscript(turns: TranscriptTurn[], liveCaption: string): string {
  if (liveCaption.trim()) return liveCaption;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") return turns[i].content;
  }
  return "";
}

export const STATUS_LABELS: Record<DexStatus, string> = {
  idle: "Initialising…",
  listening_wake: "Asleep · waiting for wake word",
  active_listening: "Awake · listening to you",
  follow_up_listening: "Awake · listening to you",
  thinking: "Awake · thinking",
  speaking: "Awake · speaking",
  muted: "Paused · microphone off",
  error: "Something went wrong",
  unsupported: "Voice not supported in this browser",
};

export function awarenessLabel(status: DexStatus, wakeWord = "Dex"): string {
  return status === "listening_wake" ? `Asleep · say ${wakeWord}` : STATUS_LABELS[status];
}
