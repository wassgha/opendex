/** Hold spoken-turn output until asynchronous transcription confirms speech.
 * Audio capture and server interruption remain live. Text requests bypass this.
 * An unconfirmed turn ends the session so invented output cannot become history.
 */
export class SpokenTurnGuard<T extends { responseId: string }> {
  private turn: { itemId?: string; accepted: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
  private responses = new Map<string, { turn: NonNullable<SpokenTurnGuard<T>["turn"]>; events: T[] }>();
  private closed = false;
  constructor(private deliver: (event: T) => void, private reject: () => void, private timeoutMs = 5000) {}

  speechStarted(itemId?: string) {
    if (this.closed) return;
    if (this.turn?.timer) clearTimeout(this.turn.timer);
    this.turn = { itemId, accepted: false };
  }
  userText() {
    if (this.turn?.timer) clearTimeout(this.turn.timer);
    this.turn = null;
  }
  speechStopped(itemId?: string) {
    if (!this.turn || this.closed) return;
    this.turn.itemId ??= itemId;
    if (!this.turn.accepted && !this.turn.timer) {
      this.turn.timer = setTimeout(() => this.fail(), this.timeoutMs);
    }
  }
  transcript(itemId: string, text: string) {
    const turn = this.turn;
    // Never let a delayed transcript authorize a newer utterance.
    if (!turn || this.closed || !turn.itemId || turn.itemId !== itemId) return;
    if (!text.trim()) { this.fail(); return; }
    turn.accepted = true;
    if (turn.timer) clearTimeout(turn.timer);
    for (const [id, response] of this.responses) {
      if (response.turn !== turn) continue;
      this.responses.delete(id);
      for (const event of response.events) this.deliver(event);
    }
  }
  responseCreated(id: string, explicit: boolean) {
    if (!explicit && this.turn && !this.turn.accepted) {
      if (this.responses.size >= 100) { this.fail(); return; }
      this.responses.set(id, { turn: this.turn, events: [] });
    }
  }
  output(event: T) {
    if (this.closed) return;
    const response = this.responses.get(event.responseId);
    if (!response) { this.deliver(event); return; }
    if (response.turn !== this.turn) return;
    // Bound retained model output even if the provider streams unusually fast.
    if (response.events.length >= 512) { this.fail(); return; }
    response.events.push(event);
  }
  close() {
    this.closed = true;
    if (this.turn?.timer) clearTimeout(this.turn.timer);
    this.responses.clear();
  }
  private fail() {
    if (this.closed) return;
    this.close();
    this.reject();
  }
}
