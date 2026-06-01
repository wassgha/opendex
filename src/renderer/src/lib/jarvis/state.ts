export type JarvisStatus =
  | "idle" // very brief — before auto-engage fires
  | "listening_wake" // continuous recognition waiting for "Jarvis"
  | "active_listening" // captured wake word, listening for command
  | "follow_up_listening" // listening for a follow-up turn after a reply
  | "thinking" // hitting /api/chat
  | "speaking" // audio playing
  | "muted" // wake-word loop paused
  | "error" // unrecoverable error
  | "unsupported"; // browser doesn't support SpeechRecognition

export interface TranscriptTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export const STATUS_LABELS: Record<JarvisStatus, string> = {
  idle: "Initialising…",
  listening_wake: "Listening for “Jarvis”…",
  active_listening: "Listening…",
  follow_up_listening: "Anything else, sir?",
  thinking: "Thinking…",
  speaking: "Speaking…",
  muted: "Muted",
  error: "Something went wrong",
  unsupported: "Voice not supported in this browser",
};
