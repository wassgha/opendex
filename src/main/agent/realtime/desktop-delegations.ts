export interface DesktopJob { callId: string; name: string; task: string; progress?: string; readProgress?: () => string; archiveTarget?: string; controller?: AbortController; workerRequestId?: string }

/** One renderer worker at a time. Keep the original tool pending until its
 * delegated work and verification finish, so the voice model cannot skip it. */
export class DesktopDelegations {
  private jobs: DesktopJob[] = [];
  private completing = false;
  constructor(private dispatch: (job: DesktopJob) => void, private cancelled: (job: DesktopJob, reason: string) => void = () => {}) {}
  active(callId: string) { return this.jobs[0]?.callId === callId ? this.jobs[0] : undefined; }
  get current() { return this.jobs[0]; }
  enqueue(job: DesktopJob) {
    if (this.jobs.some(entry => entry.callId === job.callId)) return;
    job.controller = new AbortController();
    this.jobs.push(job);
    if (this.jobs.length === 1) this.dispatch(job);
  }
  beginResult(callId: string) {
    if (this.completing || this.jobs[0]?.callId !== callId) return;
    this.completing = true;
    return this.jobs[0];
  }
  finish(job: DesktopJob, dispatchNext = true) {
    if (this.jobs[0] !== job) return;
    this.jobs.shift(); this.completing = false;
    if (dispatchNext && this.jobs[0]) this.dispatch(this.jobs[0]);
  }
  clear(reason = 'desktop workflow ended') {
    const jobs = this.jobs; this.jobs = []; this.completing = false;
    for (const job of jobs) { job.controller?.abort(); this.cancelled(job, reason); }
  }
}
