import { verifyActivation } from "./verified-activation";

export interface OpenUrlInput { url: string; browser?: string }

interface UrlLauncher {
  platform: string;
  openExternal(url: string): Promise<unknown>;
  trusted(): boolean;
  native(): {
    appPath(name: string): string;
    activateApp(path: string): number;
    appVisible(pid: number): boolean;
  };
  launch(path: string, url: string): Promise<unknown>;
}

/** Open an exact URL in a named app without a screenshot/keyboard planning loop. */
export async function openUrl({ url, browser }: OpenUrlInput, launcher: UrlLauncher) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return { error: "Only http(s) and mailto URLs are allowed." };
    }
    const target = browser?.trim();
    if (!target) {
      await launcher.openExternal(parsed.href);
      return { ok: true, opened: parsed.href, verification: "URL handed to the default handler; page content is not verified." };
    }
    if (parsed.protocol === "mailto:") return { error: "A named browser requires an http(s) URL." };
    if (launcher.platform !== "darwin") {
      return { error: "Direct named-browser opening is only supported on macOS. Use available desktop controls for the requested browser; do not substitute the default browser." };
    }
    if (!launcher.trusted()) return { error: "Enable Accessibility for Dex so it can bring the requested browser forward and verify its window." };
    const native = launcher.native();
    const path = native.appPath(target);
    await launcher.launch(path, parsed.href);
    await verifyActivation(path, native);
    return { ok: true, opened: parsed.href, browser: target, verification: "URL handed to the requested browser and its focused window is visible. Page loading and search results are not verified." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
