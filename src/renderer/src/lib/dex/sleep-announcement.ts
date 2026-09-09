import { SystemSpeechEngine, type SystemVoiceOptions } from "./speech-engine";

/** The realtime mic is already disconnected before this local announcement. */
export function announceSleep(voice: SystemVoiceOptions, onDone: () => void): () => void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    speaker.stop();
    onDone();
  };
  const speaker = new SystemSpeechEngine({
    onStateChange: (speaking) => { if (!speaking) finish(); },
    onAudioBlocked: finish,
  }, voice);
  // Missing/broken system speech must not leave wake-word listening disabled.
  const timeout = setTimeout(finish, 5000);
  try { speaker.enqueue("Going to sleep."); } catch { finish(); }
  return () => {
    finished = true;
    clearTimeout(timeout);
    speaker.stop();
  };
}
