import { BrowserWindow, screen, session, type Rectangle, type WebContents } from "electron";
import { IPC, type WidgetId, type WidgetEdges, type WidgetSlot, type WidgetSlotPicker } from "../ipc/channels";
import { snapWidget, slotBounds, slotEdges, detached, SlotReservations, WIDGET_SLOTS } from "./magnet";

/** Independent views, never owners of a voice session. */
export class WidgetWindows {
  private readonly windows = new Map<WidgetId, BrowserWindow>();
  private readonly edges = new Map<BrowserWindow, WidgetEdges>();
  private readonly slots = new SlotReservations<BrowserWindow>();
  private readonly place = new Map<BrowserWindow, (slot: WidgetSlot) => boolean>();
  private picker?: { window: BrowserWindow; target: BrowserWindow; displayId: number };

  constructor(
    private readonly preload: string,
    private readonly load: (window: BrowserWindow, id: WidgetId | "slots") => void,
  ) {}

  show() {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const widgetSession = session.fromPartition("opendex-widgets");
    widgetSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    widgetSession.setPermissionCheckHandler(() => false);
    for (const [index, id] of (["light", "goal"] as const).entries()) {
      const existing = this.windows.get(id);
      if (existing && !existing.isDestroyed()) {
        const bounds = existing.getBounds();
        // Recover windows stranded by a removed display; otherwise retain position.
        if (!screen.getAllDisplays().some(({ bounds: a }) =>
          bounds.x >= a.x && bounds.y >= a.y &&
          bounds.x + bounds.width <= a.x + a.width && bounds.y + bounds.height <= a.y + a.height)) {
          existing.setPosition(area.x + Math.max(0, area.width - bounds.width - 24),
            area.y + Math.max(0, Math.min(24 + index * 190, area.height - bounds.height)));
        }
        if (!existing.webContents.isLoadingMainFrame()) existing.showInactive();
        continue;
      }
      const width = Math.min(300, area.width);
      const height = Math.min(id === "light" ? 170 : 220, area.height);
      const win = new BrowserWindow({
        title: id === "light" ? "Dex · Preview light" : "Dex · Goal counter",
        width, height,
        x: area.x + Math.max(0, area.width - width - 24),
        y: area.y + Math.max(0, Math.min(24 + index * 190, area.height - height)),
        show: false, frame: false, transparent: true, resizable: false,
        movable: true, skipTaskbar: true, hasShadow: false,
        roundedCorners: false, // CSS owns the edge-attached notch silhouette.
        backgroundColor: "#00000000",
        webPreferences: {
          preload: this.preload, contextIsolation: true, nodeIntegration: false,
          sandbox: true, session: widgetSession,
        },
      });
      this.windows.set(id, win);
      this.attachMagnets(win);
      win.setAlwaysOnTop(true, "floating");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.once("did-finish-load", () => win.showInactive());
      // A failed load must not leave an invisible singleton blocking a retry.
      win.webContents.once("did-fail-load", () => win.destroy());
      win.on("closed", () => this.windows.delete(id));
      this.load(win, id);
    }
  }

  close(sender: WebContents) {
    if (this.picker?.window.webContents === sender) { this.picker.window.close(); return; }
    for (const win of this.windows.values()) {
      if (win.webContents === sender) { win.close(); return; }
    }
  }

  getEdges(sender: WebContents): WidgetEdges {
    for (const win of this.windows.values()) {
      if (win.webContents === sender) return this.edges.get(win) ?? detached();
    }
    throw new Error("Only a widget can read its docking state.");
  }

  showSlots(sender: WebContents, focus = true) {
    const target = [...this.windows.values()].find(win => win.webContents === sender);
    if (!target) throw new Error("Only a widget can open its slot picker.");
    const display = screen.getDisplayMatching(target.getBounds());
    if (this.picker?.target === target && this.picker.displayId === display.id) {
      this.refreshPicker();
      if (focus) this.picker.window.show();
      return;
    }
    this.picker?.window.close();
    const win = new BrowserWindow({
      ...display.bounds, show: false, frame: false, transparent: true,
      roundedCorners: false, resizable: false, movable: false, skipTaskbar: true,
      hasShadow: false, backgroundColor: "#00000000",
      webPreferences: { preload: this.preload, contextIsolation: true,
        nodeIntegration: false, sandbox: true, session: target.webContents.session },
    });
    this.picker = { window: win, target, displayId: display.id };
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Reapply after raising the level so macOS does not inset it below the menu bar.
    win.setBounds(display.bounds);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", event => event.preventDefault());
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape") { event.preventDefault(); win.close(); }
    });
    const escape = (event: Electron.Event, input: Electron.Input) => {
      if (input.key === "Escape" && !win.isDestroyed()) { event.preventDefault(); win.close(); }
    };
    target.webContents.on("before-input-event", escape);
    win.webContents.once("did-finish-load", () => { focus ? win.show() : win.showInactive(); this.refreshPicker(); });
    win.webContents.once("did-fail-load", () => win.destroy());
    win.once("closed", () => {
      if (!target.isDestroyed()) target.webContents.removeListener("before-input-event", escape);
      if (this.picker?.window === win) this.picker = undefined;
    });
    this.load(win, "slots");
  }

  getSlots(sender: WebContents): WidgetSlotPicker {
    const picker = this.picker;
    if (!picker || picker.window.webContents !== sender || picker.target.isDestroyed()) {
      throw new Error("Only the active slot picker can read its targets.");
    }
    const display = screen.getAllDisplays().find(d => d.id === picker.displayId);
    if (!display) throw new Error("The selected display is no longer available.");
    return {
      width: display.bounds.width, height: display.bounds.height,
      title: this.windows.get("goal") === picker.target ? "Goal counter" : "Preview light",
      slots: WIDGET_SLOTS.map(id => {
        const bounds = slotBounds(picker.target.getBounds(), display.bounds, id);
        return { id, occupied: !this.slots.available(picker.target, display.id, id, bounds),
          current: this.edges.get(picker.target)?.slot === id,
          ...bounds, x: bounds.x - display.bounds.x, y: bounds.y - display.bounds.y };
      }),
    };
  }

  chooseSlot(sender: WebContents, slot: unknown): boolean {
    const picker = this.picker;
    if (!picker || picker.window.webContents !== sender || typeof slot !== "string"
      || !WIDGET_SLOTS.includes(slot as WidgetSlot)) throw new Error("Invalid slot selection.");
    // Revalidate ownership on click, even if the overlay's snapshot was free.
    if (screen.getDisplayMatching(picker.target.getBounds()).id !== picker.displayId) {
      picker.window.close();
      return false;
    }
    const target = this.getSlots(sender).slots.find(item => item.id === slot)!;
    if (target.occupied) { this.refreshPicker(); return false; }
    const placed = this.place.get(picker.target)?.(slot as WidgetSlot) ?? false;
    if (placed) picker.window.close();
    else this.refreshPicker();
    return placed;
  }

  private refreshPicker() {
    if (!this.picker || this.picker.window.isDestroyed() || this.picker.target.isDestroyed()) return;
    if (!screen.getAllDisplays().some(d => d.id === this.picker!.displayId)) {
      this.picker.window.close();
      return;
    }
    this.picker.window.webContents.send(IPC.widgetSlotsChanged, this.getSlots(this.picker.window.webContents));
  }

  private attachMagnets(win: BrowserWindow) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let displayId = screen.getDisplayMatching(win.getBounds()).id;
    const hasManualMoveEvent = process.platform === "darwin" || process.platform === "win32";
    let manualMove = false;
    let restoringPosition = false;
    let placedBounds: { x: number; y: number } | undefined;
    const moveTo = (bounds: Rectangle) => {
      clearTimeout(timer);
      placedBounds = bounds;
      const current = win.getBounds();
      if (current.x !== bounds.x || current.y !== bounds.y) {
        win.setPosition(bounds.x, bounds.y);
      }
    };
    const publish = (edges: WidgetEdges) => {
      this.edges.set(win, edges);
      // Clipped windows sit at the physical screen edge, above menu bar/Dock.
      win.setAlwaysOnTop(true, edges.slot ? "screen-saver" : "floating");
      win.webContents.send(IPC.widgetEdgesChanged, edges);
      this.refreshPicker();
    };
    this.place.set(win, (slot) => {
      clearTimeout(timer);
      manualMove = false;
      restoringPosition = false;
      const display = screen.getDisplayMatching(win.getBounds());
      const target = slotBounds(win.getBounds(), display.bounds, slot);
      if (!this.slots.claim(win, display.id, slot, target)) return false;
      displayId = display.id;
      publish(slotEdges(slot));
      moveTo(target);
      return true;
    });
    const snap = () => {
      if (win.isDestroyed()) return;
      manualMove = false;
      const before = win.getBounds();
      const display = screen.getDisplayMatching(before);
      const nearEdge = snapWidget(before, display.bounds).edges.slot !== null;
      this.slots.release(win);
      displayId = display.id;
      publish(detached());
      // Moving never selects or rejects a hidden destination. Show the choices.
      if (nearEdge) this.showSlots(win.webContents, false);
      else if (this.picker?.target === win) this.picker.window.close();
    };
    // Electron documents will-move as manual-only on macOS/Windows. Ordinary
    // move also fires for placement/focus/OS adjustments and cannot imply drag.
    win.on("will-move", () => {
      manualMove = true;
      restoringPosition = false;
      placedBounds = undefined;
      clearTimeout(timer);
    });
    win.on("move", () => {
      const current = win.getBounds();
      if (hasManualMoveEvent && !manualMove) {
        // A late native adjustment must not release the slot or reopen its
        // picker. Restore the committed anchor once, without a retry loop if
        // the OS refuses it. A real drag or new placement resets the guard.
        if (this.edges.get(win)?.slot && placedBounds && !restoringPosition
          && (current.x !== placedBounds.x || current.y !== placedBounds.y)) {
          restoringPosition = true;
          const anchor = { ...current, ...placedBounds };
          timer = setTimeout(() => {
            if (!win.isDestroyed() && !manualMove && this.edges.get(win)?.slot) moveTo(anchor);
          }, 80);
        }
        return;
      }
      clearTimeout(timer);
      if (placedBounds && current.x === placedBounds.x && current.y === placedBounds.y) {
        return;
      }
      placedBounds = undefined;
      timer = setTimeout(snap, 160);
    });
    const reposition = () => {
      if (this.picker?.target === win) this.picker.window.close();
      if (win.isDestroyed()) return;
      clearTimeout(timer);
      manualMove = false;
      restoringPosition = false;
      const oldBounds = win.getBounds();
      const display = screen.getAllDisplays().find(d => d.id === displayId)
        ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      displayId = display.id;
      const area = display.bounds;
      const previous = this.edges.get(win) ?? detached();
      this.slots.release(win);
      if (previous.slot) {
        // Preserve the slot when possible. On display removal, existing owners
        // win; pick another free slot rather than merging two reservations.
        for (const slot of [previous.slot, ...WIDGET_SLOTS.filter(s => s !== previous.slot)]) {
          const target = slotBounds(oldBounds, area, slot);
          if (this.slots.claim(win, display.id, slot, target)) {
            publish(slotEdges(slot));
            moveTo(target);
            return;
          }
        }
      }
      publish(detached());
      moveTo({ ...oldBounds,
        x: Math.max(area.x, Math.min(oldBounds.x, area.x + area.width - oldBounds.width)),
        y: Math.max(area.y, Math.min(oldBounds.y, area.y + area.height - oldBounds.height)),
      });
    };
    screen.on("display-metrics-changed", reposition);
    screen.on("display-removed", reposition);
    win.once("closed", () => {
      clearTimeout(timer);
      this.edges.delete(win);
      this.slots.release(win);
      this.place.delete(win);
      if (this.picker?.target === win) this.picker.window.close();
      this.refreshPicker();
      screen.removeListener("display-metrics-changed", reposition);
      screen.removeListener("display-removed", reposition);
    });
  }
}
