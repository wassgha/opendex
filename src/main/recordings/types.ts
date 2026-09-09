export interface RecordingOptions {
  sourceId: string;
  microphone: boolean;
  systemAudio: boolean;
}
export interface RecordingSource { id: string; name: string }
export interface RecordingEntry {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  bytes: number;
  mimeType: string;
  extension: "mp4" | "webm";
  status: "complete" | "interrupted";
  microphone: boolean;
  systemAudio: boolean;
}
export interface RecordingState {
  phase: "idle" | "starting" | "recording" | "saving";
  id?: string;
  startedAt?: number;
  error?: string;
}
// H.264 + AAC gives exported demos broad player/social-app compatibility.
export const RECORDING_MIMES = ["video/mp4;codecs=avc1.42001E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"] as const;
export const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_RECORDING_MS = 30 * 60 * 1000;
