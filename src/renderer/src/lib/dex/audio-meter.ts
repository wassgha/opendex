// Real-time amplitude metering of the microphone, used to make the voice
// visualizations react to the user's voice while listening. Speaking-side
// amplitude is synthesized in use-dex (no audio routing needed), so this
// only meters the mic input — which never connects to the destination, so
// there's no feedback or autoplay risk.

export class AudioMeter {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private currentStream: MediaStream | null = null;

  private ensureCtx() {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  /** Point the meter at a mic stream. Safe to call repeatedly. */
  attachMicStream(stream: MediaStream) {
    this.ensureCtx();
    if (!this.ctx || !this.analyser) return;
    if (this.currentStream === stream && this.micSource) return;
    this.micSource?.disconnect();
    this.currentStream = stream;
    try {
      this.micSource = this.ctx.createMediaStreamSource(stream);
      // Connect to the analyser only — never to destination (no echo).
      this.micSource.connect(this.analyser);
      void this.ctx.resume();
    } catch {
      this.micSource = null;
    }
  }

  /** Resume the context (call after a user gesture if it started suspended). */
  resume() {
    void this.ctx?.resume();
  }

  /** Current mic loudness, 0..1 (RMS of the time-domain signal). */
  inputLevel(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sumSquares = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / this.data.length);
    // Scale up — speech RMS is small — and clamp.
    return Math.min(1, rms * 3.2);
  }

  dispose() {
    this.micSource?.disconnect();
    this.micSource = null;
    this.currentStream = null;
    this.analyser = null;
    this.data = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
