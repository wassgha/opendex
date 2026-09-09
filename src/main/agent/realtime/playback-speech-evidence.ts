/** Small, audio-free history on the same PCM clock as OpenAI audio_start/end_ms.
 * Require sustained speech, not isolated detector spikes, during playback and
 * its echo tail. Moderate sustained speech remains eligible without a volume gate.
 */
export class PlaybackSpeechEvidence {
  private elapsed = 0;
  private playbackUntil = 0;
  private frames: { start: number; end: number; probability?: number; playback: boolean }[] = [];
  private turns = new Map<string, { id: string; start?: number; end?: number; playback: boolean }>();

  append(bytes: number, probability: number | undefined, playback: boolean) {
    const start = this.elapsed;
    this.elapsed += bytes / 48; // mono PCM16, 24kHz
    if (playback) this.playbackUntil = this.elapsed + 750;
    this.frames.push({ start, end: this.elapsed, playback: playback || start < this.playbackUntil,
      probability: typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability : undefined });
    while (this.frames.length && this.frames[0].end < this.elapsed - 60_000) this.frames.shift();
  }
  begin(id: string | undefined, raw: unknown) {
    if (!id) return;
    this.turns.set(id, { id, start: timestamp(raw, 'audio_start_ms'), playback: this.frames.at(-1)?.playback ?? false });
    if (this.turns.size > 64) this.turns.delete(this.turns.keys().next().value!);
  }
  end(id: string | undefined, raw: unknown) {
    const turn = id ? this.turns.get(id) : undefined;
    if (turn) turn.end = timestamp(raw, 'audio_end_ms');
  }
  assess(id: string) {
    const turn = this.turns.get(id);
    const uncertain = { reject: turn?.playback ?? this.frames.at(-1)?.playback ?? false, reason: 'incomplete-evidence', playback: turn?.playback ?? this.frames.at(-1)?.playback ?? false, observedMs: 0, sustainedMs: 0, cleanSustainedMs: 0 };
    if (!turn || turn.id !== id || turn.start === undefined || turn.end === undefined) return uncertain;
    const { start, end } = turn;
    if (end <= start || end > this.elapsed || start < (this.frames[0]?.start ?? Infinity)) return uncertain;
    const frames = this.frames.filter(f => f.end > start && f.start < end);
    const playback = frames.some(f => f.playback);
    // Wake replay has no Silero scores. Preserve that initial listening path.
    // During playback, missing evidence must not authorize an interruption.
    if (!frames.length || frames.some(f => f.probability === undefined)) return { ...uncertain, playback, reject: playback };
    let run = 0, sustainedMs = 0, cleanRun = 0, cleanSustainedMs = 0;
    for (const frame of frames) {
      const duration = Math.min(frame.end, end) - Math.max(frame.start, start);
      run = frame.probability! >= 0.2 ? run + duration : 0;
      sustainedMs = Math.max(sustainedMs, run);
      cleanRun = !frame.playback && frame.probability! >= 0.2 ? cleanRun + duration : 0;
      cleanSustainedMs = Math.max(cleanSustainedMs, cleanRun);
    }
    const reject = sustainedMs < (playback ? 160 : 96);
    return { reject, reason: reject ? 'insufficient-sustained-speech' : 'sustained-speech', playback,
      observedMs: Math.round(end - start), sustainedMs: Math.round(sustainedMs), cleanSustainedMs: Math.round(cleanSustainedMs) };
  }
  rejects(id: string): boolean { return this.assess(id).reject; }

}

function timestamp(raw: unknown, key: string): number | undefined {
  // Direct OpenAI events and Gateway's nested original event are both supported.
  for (let depth = 0; depth < 3 && raw && typeof raw === 'object'; depth++) {
    const event = raw as Record<string, unknown>;
    if (typeof event[key] === 'number' && Number.isFinite(event[key]) && event[key] >= 0) return event[key];
    raw = event.raw;
  }
  return undefined;
}
