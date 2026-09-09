import { AsyncLocalStorage } from "node:async_hooks";

/** A worker owns its image coordinate space; OS actions remain serial across workers. */
export class DesktopExecution<Shot> {
  private states = new WeakMap<object, { shot: Shot | null; focus?: string; signal?: AbortSignal }>();
  private local = new AsyncLocalStorage<{ shot: Shot | null; focus?: string; signal?: AbortSignal }>();
  private tail: Promise<unknown> = Promise.resolve();
  private owner: object | undefined;
  state() {
    const state = this.local.getStore();
    if (!state) throw new Error("No desktop task context.");
    return state;
  }
  checkpoint() { this.state().signal?.throwIfAborted(); }
  run<T>(owner: object, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    let state = this.states.get(owner);
    if (!state) { state = { shot: null, signal }; this.states.set(owner, state); }
    const run = this.tail.catch(() => {}).then(() => this.local.run(state!, async () => {
      this.checkpoint();
      if (this.owner && this.owner !== owner) state!.shot = null;
      this.owner = owner;
      return action();
    }));
    this.tail = run.catch(() => {});
    return run;
  }
}
