/** A launch acknowledgment is not evidence that the requested window is visible. */
export async function verifyActivation(
  path: string,
  native: { activateApp(path: string): number; appVisible(pid: number): boolean },
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 100)),
): Promise<void> {
  let pid = native.activateApp(path);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (native.appVisible(pid)) return;
    await wait();
    // Restore/raise again after launch or the Dock animation settles.
    if (attempt === 9) pid = native.activateApp(path);
  }
  throw new Error('The app launched, but its focused window is not visible on the current desktop. In System Settings → Desktop & Dock → Mission Control, enable “When switching to an application, switch to a Space with open windows for the application”, then try again.');
}
