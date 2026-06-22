import { app, BrowserWindow, dialog } from "electron";
import log from "electron-log";
import electronUpdater from "electron-updater";
import { track } from "./analytics";
import { IPC, type UpdateStatusPayload } from "./ipc/channels";

// electron-updater ships CommonJS; pull autoUpdater off the default export so
// it works under our ESM/electron-vite build.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Broadcast an update-status event to every open window (the banner UI). */
function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateStatus, payload);
  }
}

/**
 * Wire up auto-updates against GitHub Releases (provider configured in
 * package.json `build.publish`). electron-updater reads the `latest-*.yml`
 * manifests published alongside the installers — no separate update server.
 *
 * Only runs in packaged builds; dev launches never check for updates.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.logger = log;
  log.transports.file.level = "info";
  // Download in the background; we prompt the user before installing.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    log.error("[updater] error", err);
    broadcast({ state: "error", message: err?.message ?? String(err) });
  });
  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking for update");
  });
  autoUpdater.on("update-available", (info) => {
    log.info("[updater] update available", info.version);
    // autoDownload is on, so an available update is already downloading.
    broadcast({ state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    log.info("[updater] up to date");
  });
  autoUpdater.on("download-progress", (progress) => {
    broadcast({ state: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("[updater] update downloaded", info.version);
    track("update_downloaded", { update_version: info.version });
    broadcast({ state: "downloaded", version: info.version });
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update available",
        message: `OpenDex ${info.version} is ready to install.`,
        detail: "Restart now to apply the update.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  void autoUpdater.checkForUpdates();
  setInterval(() => {
    void autoUpdater.checkForUpdates();
  }, CHECK_INTERVAL_MS);
}
