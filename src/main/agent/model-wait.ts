/** Bound silent model waits, but never time out a permission prompt or tool. */
export class ModelWait {
  readonly controller = new AbortController();
  timedOut = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private ms = 90000) {}
  waiting() {
    this.pause();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort(new Error('The model did not produce text or an action before the wait limit.'));
    }, this.ms);
  }
  pause() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
