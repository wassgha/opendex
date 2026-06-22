import { useEffect, useState } from "react";

// Always points at the newest release's assets (GitHub redirects `latest`).
export const REL = "https://github.com/wassgha/opendex/releases/latest/download";
export const REPO = "https://github.com/wassgha/opendex";

export type OSKey = "mac-arm64" | "mac-x64" | "win" | "linux-appimage" | "linux-deb";

export const FILES: Record<OSKey, string> = {
  "mac-arm64": "OpenDex-mac-arm64.dmg",
  "mac-x64": "OpenDex-mac-x64.dmg",
  win: "OpenDex-Setup.exe",
  "linux-appimage": "OpenDex-linux.AppImage",
  "linux-deb": "OpenDex-linux.deb",
};

export const downloadUrl = (os: OSKey) => `${REL}/${FILES[os]}`;

export interface Detected {
  os: OSKey;
  label: string;
  note: string;
}

const DEFAULT: Detected = { os: "mac-arm64", label: "Download for macOS", note: "" };

// userAgentData is not in the default TS DOM lib; treat it as optional.
type UAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

async function detect(): Promise<Detected> {
  const ua = navigator.userAgent;
  const uaData = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  const platform = (uaData?.platform || navigator.platform || "").toLowerCase();

  const isWindows = platform.includes("win") || /windows/i.test(ua);
  const isLinux = platform.includes("linux") || /linux|x11/i.test(ua);
  // Check mac last: many UA strings mention "Mac" even on iOS, but the desktop
  // app only targets desktop OSes, so this ordering is fine.
  const isMac = platform.includes("mac") || /mac os x/i.test(ua);

  if (isWindows) {
    return { os: "win", label: "Download for Windows", note: "Windows installer (.exe)" };
  }
  if (isLinux) {
    return {
      os: "linux-appimage",
      label: "Download for Linux",
      note: "AppImage — .deb also available below",
    };
  }
  if (isMac) {
    let arm = true; // default to Apple Silicon when arch is unknown
    try {
      const hev = await uaData?.getHighEntropyValues?.(["architecture"]);
      if (hev?.architecture) arm = hev.architecture === "arm";
    } catch {
      /* keep the Apple-Silicon default */
    }
    return arm
      ? { os: "mac-arm64", label: "Download for macOS", note: "Apple Silicon — Intel below" }
      : { os: "mac-x64", label: "Download for macOS", note: "Intel — Apple Silicon below" };
  }
  // Unknown platform: fall back to the most common desktop target.
  return DEFAULT;
}

// Detect the visitor's OS once, returning the best-guess primary download.
export function useDetectedDownload(): Detected {
  const [detected, setDetected] = useState<Detected>(DEFAULT);
  useEffect(() => {
    let alive = true;
    void detect().then((d) => {
      if (alive) setDetected(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return detected;
}

// Press "D" anywhere (outside inputs) to download — mirrors the nav's key hint.
export function useDownloadHotkey(href: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        window.location.href = href;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [href]);
}
