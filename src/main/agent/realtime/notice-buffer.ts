import type { RealtimeServerNotice } from "../../ipc/channels";

/** Hold startup notices until preload has installed the per-session listener. */
export class RealtimeNoticeBuffer {
  private pending: RealtimeServerNotice[] = [];
  private ready = false;
  private disposed = false;
  constructor(private deliver: (notice: RealtimeServerNotice) => void) {}

  push(notice: RealtimeServerNotice): void {
    if (this.disposed) return;
    if (this.ready) { this.deliver(notice); return; }
    // A startup failure is more useful than audio or bookkeeping. Preserve it
    // even if the provider closes immediately after reporting the reason.
    if (this.pending.some(item => item.type === "error")) return;
    if (notice.type === "error") { this.pending = [notice]; return; }
    if (this.pending.length >= 64) {
      this.pending = [{ type: "error", message: "Voice connection startup overflow" }];
      return;
    }
    this.pending.push(notice);
  }

  subscribe(): void {
    if (this.disposed || this.ready) return;
    this.ready = true;
    const pending = this.pending;
    this.pending = [];
    for (const notice of pending) {
      if (this.disposed) break;
      this.deliver(notice);
    }
  }

  dispose(): void { this.disposed = true; this.pending = []; }
}
