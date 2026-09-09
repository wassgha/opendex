/** Retain finalized speech segments while earlier transcriptions are pending.
 * Provider transcripts may arrive out of order, especially during wake replay.
 * Tentative VAD never interrupts work; only ordered, nonempty text is accepted. */
export class ConfirmedSpeech {
  private turns = new Map<string, { text?: string; timer?: ReturnType<typeof setTimeout> }>();
  private anonymous = false;
  constructor(private accept: (text: string, itemId: string, segments: { text: string; itemId: string }[]) => void,
    private discard: (itemId?: string) => void, private timeoutMs = 5000) {}
  speechStarted(itemId?: string) {
    if (!itemId) { this.anonymous = true; return; }
    if (!this.turns.has(itemId)) this.turns.set(itemId, {});
    // Bound retained state even if a provider never sends speech-stopped.
    if (this.turns.size > 64) {
      const first = this.turns.keys().next().value!;
      this.remove(first); this.discard(first);
    }
  }
  speechStopped(itemId?: string) {
    if (itemId && this.anonymous) { this.anonymous = false; this.speechStarted(itemId); }
    const turn = itemId ? this.turns.get(itemId) : undefined;
    if (!turn || !itemId || turn.timer) return;
    turn.timer = setTimeout(() => {
      if (this.turns.get(itemId) !== turn) return;
      turn.text = ''; this.drain();
    }, this.timeoutMs);
  }
  transcript(itemId: string, text: string) {
    const turn = this.turns.get(itemId);
    if (!turn || turn.text !== undefined) return;
    if (turn.timer) clearTimeout(turn.timer);
    turn.text = text.trim();
    this.drain();
  }
  private remove(id: string) {
    const turn = this.turns.get(id);
    if (turn?.timer) clearTimeout(turn.timer);
    this.turns.delete(id);
  }
  private drain() {
    // Wait for every already-detected segment before authorizing a response.
    // This keeps a rapid wake replay from executing its first clause in isolation.
    if ([...this.turns.values()].some(turn => turn.text === undefined)) return;
    const segments: { text: string; itemId: string }[] = [];
    for (const [id, turn] of this.turns) {
      this.remove(id);
      if (turn.text) segments.push({ text: turn.text, itemId: id });
      else this.discard(id);
    }
    if (segments.length) this.accept(segments.map(s => s.text).join(' '), segments.at(-1)!.itemId, segments);
  }

  clear() {
    for (const id of this.turns.keys()) this.remove(id);
    this.anonymous = false;
  }
}
