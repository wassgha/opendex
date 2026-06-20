import { desktopCapturer, screen } from "electron";

export interface Screenshot {
  /** Base64-encoded PNG (no data: prefix). */
  base64: string;
  mediaType: "image/png";
  /** Pixel size of the image the model sees. */
  width: number;
  height: number;
  /** Logical (point) size of the captured display. */
  logicalWidth: number;
  logicalHeight: number;
}

// Screenshots are captured at (at most) this width to keep token cost sane while
// staying legible. Coordinates the model returns are scaled back up to the real
// display via `toScreenPoint`.
const MAX_WIDTH = 1366;

/**
 * Capture the primary display as a PNG via Electron's `desktopCapturer`
 * (no native module needed). On macOS this requires Screen Recording permission;
 * if it's missing the capture comes back empty and we say so.
 */
export async function captureScreen(): Promise<Screenshot | { error: string }> {
  const display = screen.getPrimaryDisplay();
  const { width: logicalWidth, height: logicalHeight } = display.size;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: logicalWidth, height: logicalHeight },
  });

  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) return { error: "No screen source is available to capture." };

  let image = source.thumbnail;
  if (image.isEmpty()) {
    return {
      error:
        "Screen capture came back empty. On macOS, grant OpenDex Screen Recording permission in System Settings → Privacy & Security, then try again.",
    };
  }

  if (image.getSize().width > MAX_WIDTH) {
    image = image.resize({ width: MAX_WIDTH });
  }
  const size = image.getSize();

  return {
    base64: image.toPNG().toString("base64"),
    mediaType: "image/png",
    width: size.width,
    height: size.height,
    logicalWidth,
    logicalHeight,
  };
}

/** Map a coordinate expressed in the most-recent screenshot's pixel space onto
 *  the real (logical) display coordinates the OS input layer expects. */
export function toScreenPoint(
  x: number,
  y: number,
  shot: { width: number; height: number; logicalWidth: number; logicalHeight: number },
): { x: number; y: number } {
  const sx = shot.logicalWidth / shot.width;
  const sy = shot.logicalHeight / shot.height;
  return { x: Math.round(x * sx), y: Math.round(y * sy) };
}
