/** Silero probabilities, not loudness, determine which live mic frames pass.
 * Listening accepts 96ms of moderate speech confidence; playback requires
 * 160ms of high confidence to resist echo. Both preserve onset via pre-roll. */
export class SpeechGate {
  private pending: Float32Array[] = [];
  private positive = 0;
  private quiet = 0;
  private playback = true;
  private open = false;
  constructor(private onState: (open: boolean) => void = () => {}) {}
  process(probability: number, frame: Float32Array, playback = true): Float32Array[] {
    // Do not combine onset evidence across playback/listening policies.
    if (playback !== this.playback) { this.positive = 0; this.playback = playback; }
    if (!this.open) {
      this.pending.push(frame.slice());
      if (this.pending.length > 10) this.pending.shift();
      this.positive = probability >= (playback ? 0.65 : 0.5) ? this.positive + 1 : 0;
      if (this.positive >= (playback ? 5 : 3)) {
        this.open = true; this.quiet = 0; this.onState(true);
        const frames = this.pending; this.pending = []; return frames;
      }
      return [new Float32Array(frame.length)];
    }
    // Once speech is confirmed, preserve quieter words and short pauses.
    // Requiring a fresh onset every 320ms could cut a steering command short.
    this.quiet = probability < 0.20 ? this.quiet + 1 : 0;
    if (this.quiet >= 25) {
      this.open = false; this.positive = 0; this.pending = []; this.onState(false);
      return [new Float32Array(frame.length)];
    }
    return [frame];
  }
  clear() { this.pending.forEach(f => f.fill(0)); this.pending=[]; this.open=false; this.positive=0; this.quiet=0; }
}
export function pcm24k(frame: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(Math.round(frame.length * 1.5));
  for (let i=0;i<pcm.length;i++) {
    const position=i/1.5, left=Math.floor(position), fraction=position-left;
    const value=Math.max(-1, Math.min(1, frame[left]*(1-fraction)+frame[Math.min(left+1,frame.length-1)]*fraction));
    pcm[i]=value < 0 ? value*32768 : value*32767;
  }
  return pcm.buffer;
}
