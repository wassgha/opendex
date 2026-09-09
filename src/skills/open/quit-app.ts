export interface QuitControls {
  appPath(name: string): string;
  requestQuit(path: string): number;
  appRunning(pid: number): boolean;
}
/** An accepted termination request is not evidence that the app exited. */
export async function quitApp(name: string, native: QuitControls,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 100))) {
  try {
    const pid = native.requestQuit(native.appPath(name));
    if (!pid) return { ok: true, app: name, status: "already_closed" };
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!native.appRunning(pid)) return { ok: true, app: name, status: "quit" };
      await wait();
    }
    return { ok: false, app: name, status: "still_running", error: "The app is still running after the quit request. It may need your attention. No force quit or automatic retry was performed." };
  } catch (error) {
    return { ok: false, app: name, error: error instanceof Error ? error.message : String(error) };
  }
}
