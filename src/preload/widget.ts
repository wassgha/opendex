import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { IPC, WidgetEdges, WidgetSlot, WidgetSlotPicker } from "../main/ipc/channels";

const widgetApi = {
  platform: process.platform,
  showSlots: (): Promise<void> => ipcRenderer.invoke("widgets:slots:show" satisfies typeof IPC.widgetSlotsShow),
  getSlots: (): Promise<WidgetSlotPicker> => ipcRenderer.invoke("widgets:slots:get" satisfies typeof IPC.widgetSlotsGet),
  chooseSlot: (slot: WidgetSlot): Promise<boolean> => ipcRenderer.invoke("widgets:slots:choose" satisfies typeof IPC.widgetSlotsChoose, slot),
  onSlotsChanged: (handler: (state: WidgetSlotPicker) => void) => {
    const channel = "widgets:slots:changed" satisfies typeof IPC.widgetSlotsChanged;
    const listener = (_event: IpcRendererEvent, state: WidgetSlotPicker) => handler(state);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  // Type-check the channel without a runtime import: sandboxed preloads cannot
  // require a shared Rollup chunk from the filesystem.
  close: () => ipcRenderer.send("widgets:close" satisfies typeof IPC.widgetsClose),
  getEdges: (): Promise<WidgetEdges> => ipcRenderer.invoke("widgets:edges:get" satisfies typeof IPC.widgetEdgesGet),
  onEdgesChanged: (handler: (edges: WidgetEdges) => void) => {
    const channel = "widgets:edges:changed" satisfies typeof IPC.widgetEdgesChanged;
    const listener = (_event: IpcRendererEvent, edges: WidgetEdges) => handler(edges);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("opendexWidget", widgetApi);
export type WidgetApi = typeof widgetApi;
