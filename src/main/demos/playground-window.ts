import { app, BrowserWindow } from "electron";
import { join } from "node:path";

let playground: BrowserWindow | null = null;
let requests = Promise.resolve<unknown>(undefined);

export function showPlayground(scene: "orbit" | "constellation") {
  const next = requests.catch(() => {}).then(async () => {
    let win = playground;
    if (!win || win.isDestroyed()) {
      win = playground = new BrowserWindow({
        title: "Dex Playground", width: 980, height: 720, minWidth: 640, minHeight: 480,
        show: false, backgroundColor: "#111315",
        webPreferences: { preload: join(app.getAppPath(), "out/preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win.on("closed", () => { playground = null; });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    }
    const hash = `playground?scene=${scene}`;
    try {
      if (!win.webContents.getURL().endsWith(`#${hash}`)) {
        if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`);
        else await win.loadFile(join(app.getAppPath(), "out/renderer/index.html"), { hash });
      }
      if (win.isDestroyed()) return { error: "The playground was closed before it finished opening." };
      win.show(); win.focus();
      return { opened: true, scene, description: "Built-in interactive particle demo. Move the pointer, change attraction or repulsion, pause, or reset. The window can be closed without ending the voice session." };
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  requests = next;
  return next;
}
