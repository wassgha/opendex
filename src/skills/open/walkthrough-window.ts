import { BrowserWindow } from 'electron';
import { walkthroughDocument, WALKTHROUGH_ORIGIN, type WalkthroughView } from './walkthrough-document';
import type { WalkthroughInput } from './code-walkthrough';

export function walkthroughAction(url: string): WalkthroughInput | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== WALKTHROUGH_ORIGIN || parsed.pathname !== '/') return null;
    const action = parsed.searchParams.get('action');
    const target = parsed.searchParams.get('target') ?? undefined;
    if (!['start', 'next', 'jump', 'end'].includes(action ?? '') || (target?.length ?? 0) > 200) return null;
    if (action === 'jump' && !target) return null;
    return { action: action as WalkthroughInput['action'], target };
  } catch { return null; }
}

/** Dedicated, sandboxed visual surface; it receives only escaped view data. */
export class WalkthroughWindow {
  private window: BrowserWindow | null = null;
  private view: WalkthroughView | null = null;
  private busy = false;
  private revision = 0;
  constructor(private command: (input: WalkthroughInput, sender: Electron.WebContents) => Promise<unknown>) {}

  async show(view: WalkthroughView, focus = false): Promise<void> {
    const revision = ++this.revision;
    this.view = view;
    let win = this.window;
    if (!win || win.isDestroyed()) {
      win = this.window = new BrowserWindow({
        title: 'Dex · Code walkthrough', width: 1180, height: 850, minWidth: 620, minHeight: 480,
        show: false, backgroundColor: '#222427',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      const owned = win;
      win.on('closed', () => {
        if (this.window === owned) { this.window = null; this.view = null; this.revision++; }
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        const input = walkthroughAction(url);
        if (!input || this.busy) return;
        this.busy = true;
        const before = this.revision;
        void this.command(input, owned.webContents).then(async result => {
          if (result && typeof result === 'object' && 'error' in result && this.view && before === this.revision) {
            await this.show({ ...this.view, error: String(result.error) }, true);
          }
        }).catch(async () => {
          if (this.view && before === this.revision) await this.show({ ...this.view, error: 'This action could not finish. Try again or ask Dex.' }, true);
        }).finally(() => { this.busy = false; }).catch(() => { /* Closed/failed surfaces must not leave an unhandled rejection. */ });
      });
    }
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(walkthroughDocument(view))}`);
    if (revision !== this.revision || win.isDestroyed()) return;
    if (focus) { win.show(); win.focus(); }
    else win.showInactive();
  }

  close() {
    this.revision++;
    this.view = null;
    this.window?.close();
  }
}
