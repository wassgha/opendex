"use client";

export type JarvisStatus =
  | "idle" // user has not engaged
  | "listening_wake" // continuous recognition waiting for "Jarvis"
  | "active_listening" // captured wake word, listening for command
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
  idle: "Tap Engage to begin",
  listening_wake: "Listening for “Jarvis”…",
  active_listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  muted: "Muted",
  error: "Something went wrong",
  unsupported: "Voice not supported in this browser",
};
