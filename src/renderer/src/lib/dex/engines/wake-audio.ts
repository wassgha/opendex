/** Original wake utterance, kept in memory only. Never persisted in diagnostics. */
export interface WakeAudio { pcm: Int16Array; sampleRate: 16000 }

/** Bounded ring indexed by the same sample clock as the Vosk recognizer. */
export class WakeAudioBuffer {
  private samples: Int16Array;
  private written = 0;
  constructor(seconds = 30) { this.samples = new Int16Array(seconds * 16000); }
  push(frame: Int16Array) {
    for (const sample of frame) this.samples[this.written++ % this.samples.length] = sample;
  }
  utterance(startSeconds: number, endSeconds: number): WakeAudio | undefined {
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return;
    const start = Math.max(0, Math.floor((startSeconds - 0.15) * 16000));
    const end = Math.min(this.written, Math.ceil((endSeconds + 0.15) * 16000));
    if (start < this.written - this.samples.length || end <= start) return;
    const pcm = new Int16Array(end - start);
    for (let i = 0; i < pcm.length; i++) pcm[i] = this.samples[(start+i) % this.samples.length];
    return { pcm, sampleRate: 16000 };
  }
  clear() { this.samples.fill(0); this.written = 0; }
}

/** Resample the confirmed utterance for the existing 24 kHz realtime stream.
 * Trailing silence lets server VAD commit the utterance; no synthetic text or
 * response-create is sent, so this produces one ordinary spoken user turn. */
export function replayWakeAudio(audio: WakeAudio): Int16Array {
  const length = Math.round(audio.pcm.length * 1.5);
  const result = new Int16Array(length + 24000 * 0.8);
  for (let i = 0; i < length; i++) {
    const position = i / 1.5;
    const left = Math.floor(position);
    const fraction = position - left;
    result[i] = Math.round(audio.pcm[left] * (1-fraction) + audio.pcm[Math.min(left+1, audio.pcm.length-1)] * fraction);
  }
  return result;
}

/** Vosk is only the wake gate. Its command hypothesis must never become a
 * realtime user message, even when the original audio is unavailable. */
export function realtimeWakeInput(mode: string, initialText?: string, initialAudio?: WakeAudio) {
  return mode === 'vosk' ? { initialAudio } : { initialText };
}
