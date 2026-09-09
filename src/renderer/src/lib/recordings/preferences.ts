import type { RecordingOptions } from "../../../../main/recordings/types";
const key = "opendex.recording-options";
export function recordingPreferences(): RecordingOptions {
  let saved: Partial<RecordingOptions> = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}") ?? {}; } catch { /* Use defaults. */ }
  return {
    sourceId: typeof saved.sourceId === "string" ? saved.sourceId : "",
    microphone: typeof saved.microphone === "boolean" ? saved.microphone : true,
    systemAudio: typeof saved.systemAudio === "boolean" ? saved.systemAudio : window.opendex.platform !== "linux",
  };
}
export function saveRecordingPreferences(options: RecordingOptions) {
  localStorage.setItem(key, JSON.stringify(options));
}
