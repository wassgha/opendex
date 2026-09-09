/** One response request at a time. Server VAD still owns spoken user turns. */
export class ResponseCoordinator {
  private busy = false;
  private speaking = false;
  private queued = false;
  private closed = false;
  private epoch = 0;
  private tools = new Map<string, number>();
  private awaitingVad = false;
  private finished = new Set<string>();
  private activeId: string | null = null;
  private progress: { toolId: string; text: string | (() => string) } | null = null;

  constructor(private create: (progress?: string) => void) {}

  reportProgress(toolId: string, text: string | (() => string)) {
    if (this.closed || this.tools.get(toolId) !== this.epoch) return;
    this.progress = { toolId, text };
    this.drain();
  }

  request() { this.queued = true; this.drain(); }
  created(id: string) { this.awaitingVad = false; this.busy = true; this.activeId = id; }
  done(id: string) {
    if (this.finished.has(id)) return;
    if (this.activeId && this.activeId !== id) return;
    this.finished.add(id);
    if (this.finished.size > 100) this.finished.delete(this.finished.values().next().value!);
    this.activeId = null;
    this.busy = false;
    this.drain();
  }
  speechStarted() {
    this.speaking = true;
    this.queued = false;
    this.progress = null;
    this.epoch++;
  }
  isToolCurrent(id: string) { return !this.closed && this.tools.get(id) === this.epoch; }
  get hasWork() { return this.busy || [...this.tools.values()].some(epoch => epoch === this.epoch); }
  get activeResponseId() { return this.activeId; }
  speechStopped(automatic = true) {
    this.speaking = false;
    if (!automatic) { this.queued = true; this.drain(); return; }
    // VAD will create the user response itself. Reserve the slot now, before
    // response-created arrives, so a simultaneous tool result cannot race it.
    this.busy = true;
    this.awaitingVad = true;
  }
  userText() { this.epoch++; this.progress = null; this.queued = true; this.drain(); }
  toolStarted(id: string) { this.tools.set(id, this.epoch); }
  toolFinished(id: string) {
    const epoch = this.tools.get(id);
    this.tools.delete(id);
    if (this.progress?.toolId === id) this.progress = null;
    if (epoch === this.epoch) this.queued = true;
    this.drain();
  }
  failed() { this.busy = false; this.awaitingVad = false; this.activeId = null; this.queued = false; this.progress = null; }
  cancel() { this.epoch++; this.queued = false; this.progress = null; }
  close() { this.closed = true; this.queued = false; this.progress = null; this.tools.clear(); }
  private drain() {
    if (this.closed || this.busy || this.awaitingVad || this.speaking) return;
    const pendingTools = [...this.tools.values()].some(epoch => epoch === this.epoch);
    if (this.queued && !pendingTools) {
      this.queued = false; this.progress = null; this.busy = true; this.create();
    } else if (this.progress && this.tools.get(this.progress.toolId) === this.epoch) {
      const text = typeof this.progress.text === 'function' ? this.progress.text() : this.progress.text;
      this.progress = null; this.busy = true; this.create(text);
    }
  }
}
