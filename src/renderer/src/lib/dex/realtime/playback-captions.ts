/** Transcript deltas have no word timestamps. Anchor each snapshot to the audio
 * queued when it arrived, rather than displaying generation ahead of playback. */
export class PlaybackCaptions {
  private pending: Array<{ at: number; text: string }> = [];
  enqueue(text: string, at: number) { this.pending.push({ text, at }); }
  advance(now: number): string | undefined {
    let text: string | undefined;
    while (this.pending.length && this.pending[0].at <= now) text = this.pending.shift()!.text;
    return text;
  }
  clear() { this.pending = []; }
}
