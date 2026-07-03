// Gapless streaming playback for the realtime model's voice: 24kHz mono PCM16
// chunks are scheduled back-to-back on a shared AudioContext (same strictly-
// ordered discipline as TtsPlayer's MP3 queue, but sample-accurate). Output is
// routed through an AnalyserNode so getAmplitude() can show the real mouth
// movement instead of the synthetic envelope.

export interface PcmPlayerCallbacks {
  /** Fires on playback start/stop (drives the speaking status). */
  onPlaybackChange: (playing: boolean) => void;
}

// Playback is "stopped" only after this much trailing silence — audio arrives
// in many small chunks and we don't want the status to flicker between them.
const DRAIN_DEBOUNCE_MS = 250;

export class StreamingPcmPlayer {
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly data: Uint8Array<ArrayBuffer>;
  private readonly callbacks: PcmPlayerCallbacks;
  private readonly sources = new Set<AudioBufferSourceNode>();
  /** Where the next chunk starts (AudioContext time). */
  private cursor = 0;
  private playing = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(ctx: AudioContext, callbacks: PcmPlayerCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    this.data = new Uint8Array(this.analyser.fftSize);
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  /** Queue one PCM16 chunk for seamless playback. */
  enqueue(chunk: ArrayBuffer): void {
    if (this.disposed || chunk.byteLength < 2) return;
    const samples = new Int16Array(chunk);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;

    const buffer = this.ctx.createBuffer(1, floats.length, this.ctx.sampleRate);
    buffer.copyToChannel(floats, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // Schedule seamlessly after the previous chunk; a small lead on a fresh
    // start absorbs scheduling jitter.
    const startAt = Math.max(this.ctx.currentTime + 0.03, this.cursor);
    this.cursor = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.scheduleDrainCheck();
    };
    source.start(startAt);

    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    if (!this.playing) {
      this.playing = true;
      this.callbacks.onPlaybackChange(true);
    }
  }

  /** Stop instantly and drop everything queued (barge-in / interrupt). */
  flush(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // never started or already stopped
      }
    }
    this.sources.clear();
    this.cursor = 0;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    if (this.playing) {
      this.playing = false;
      this.callbacks.onPlaybackChange(false);
    }
  }

  /** Current output loudness 0..1 (same RMS math as AudioMeter.inputLevel). */
  outputLevel(): number {
    if (!this.playing) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    return Math.max(0, Math.min(1, rms * 3.2));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  dispose(): void {
    this.disposed = true;
    this.flush();
    this.gain.disconnect();
    this.analyser.disconnect();
  }

  private scheduleDrainCheck(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (this.sources.size === 0 && this.playing) {
        this.playing = false;
        this.cursor = 0;
        this.callbacks.onPlaybackChange(false);
      }
    }, DRAIN_DEBOUNCE_MS);
  }
}
