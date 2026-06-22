import { desktopCapturer, type NativeImage, screen, systemPreferences } from "electron";

export interface Screenshot {
  /** Base64-encoded JPEG (no data: prefix). */
  base64: string;
  mediaType: "image/jpeg";
  /** Pixel size of the image the model sees. */
  width: number;
  height: number;
  /**
   * Mapping from this image's pixel space onto real (logical) display coords:
   *   screenX = offsetX + imgX * scaleX
   *   screenY = offsetY + imgY * scaleY
   * `offset` is the global logical coordinate of the captured region's top-left
   * (so it already accounts for which display + any zoom crop); `scale` folds in
   * both the display's point size and the downscale to MAX_WIDTH.
   */
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  /** Tiny 32×32 grayscale fingerprint for cheap frame-diffing (not sent to the model). */
  signature: Uint8Array;
}

export interface CaptureOptions {
  /** Logical display id to capture. Defaults to the display under the cursor. */
  displayId?: number;
  /** Zoom: crop this rectangle (in `regionRef`'s pixel space) before downscaling,
   *  so a small area is rendered at full detail within the MAX_WIDTH budget. */
  region?: { x: number; y: number; w: number; h: number };
  /** The screenshot whose pixel space `region` is expressed in. */
  regionRef?: Screenshot;
}

// Screenshots are captured at native resolution (so Retina detail is preserved),
// then downscaled to at most this width to keep token cost / upload latency sane
// while staying legible. Coordinates the model returns are scaled back to the
// real display via `toScreenPoint`. JPEG (much smaller than PNG) at a quality
// that keeps UI text readable.
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 80;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Build a 32×32 grayscale fingerprint from an image, for frame-diffing. */
function buildSignature(image: NativeImage): Uint8Array {
  const small = image.resize({ width: 32, height: 32 });
  const bmp = small.toBitmap(); // BGRA, row-major
  const sig = new Uint8Array(32 * 32);
  for (let i = 0; i < sig.length; i++) {
    const o = i * 4;
    sig[i] = ((bmp[o] + bmp[o + 1] + bmp[o + 2]) / 3) | 0;
  }
  return sig;
}

/** True when two fingerprints differ by more than `threshold` mean intensity. */
export function framesDiffer(a: Uint8Array, b: Uint8Array, threshold = 6): boolean {
  if (a.length !== b.length) return true;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length > threshold;
}

function pickDisplay(displayId?: number) {
  if (displayId != null) {
    const found = screen.getAllDisplays().find((d) => d.id === displayId);
    if (found) return found;
  }
  // Default to whichever display the cursor is on — that's almost always the one
  // the user means, and it makes multi-monitor "just work".
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * Capture a display (optionally a zoomed sub-region) as a downscaled JPEG via
 * Electron's `desktopCapturer` (no native module). On macOS this requires Screen
 * Recording permission; if it's missing the capture comes back empty and we say so.
 */
export async function captureScreen(
  opts: CaptureOptions = {},
): Promise<Screenshot | { error: string }> {
  if (
    process.platform === "darwin" &&
    systemPreferences.getMediaAccessStatus("screen") !== "granted"
  ) {
    return {
      error:
        "I don't have Screen Recording permission, so I can't see the screen yet. Please enable OpenDex (in dev, the Electron app) under System Settings, Privacy and Security, Screen Recording, then restart me and try again.",
    };
  }

  const display = pickDisplay(opts.displayId);
  const scale = display.scaleFactor || 1;
  const { width: logW, height: logH } = display.size;

  // Request the thumbnail at native resolution so text stays crisp; we downscale
  // ourselves afterwards to the MAX_WIDTH budget.
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(logW * scale),
      height: Math.round(logH * scale),
    },
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

  const native = image.getSize(); // true captured pixel size
  const nScaleX = native.width / logW; // native px per logical point
  const nScaleY = native.height / logH;

  // Region of the display we end up encoding, in *global logical* coords. Starts
  // as the whole display; narrows when a zoom region is requested.
  let regionLogX = display.bounds.x;
  let regionLogY = display.bounds.y;
  let regionLogW = logW;
  let regionLogH = logH;

  if (opts.region && opts.regionRef) {
    const ref = opts.regionRef;
    // region (in ref's image space) → global logical coords.
    const gx = ref.offsetX + opts.region.x * ref.scaleX;
    const gy = ref.offsetY + opts.region.y * ref.scaleY;
    const gw = opts.region.w * ref.scaleX;
    const gh = opts.region.h * ref.scaleY;
    // Clamp to this display's logical bounds.
    regionLogX = clamp(gx, display.bounds.x, display.bounds.x + logW);
    regionLogY = clamp(gy, display.bounds.y, display.bounds.y + logH);
    regionLogW = clamp(gw, 1, display.bounds.x + logW - regionLogX);
    regionLogH = clamp(gh, 1, display.bounds.y + logH - regionLogY);
    // → native pixels of the captured image, then crop.
    image = image.crop({
      x: Math.round((regionLogX - display.bounds.x) * nScaleX),
      y: Math.round((regionLogY - display.bounds.y) * nScaleY),
      width: Math.max(1, Math.round(regionLogW * nScaleX)),
      height: Math.max(1, Math.round(regionLogH * nScaleY)),
    });
  }

  if (image.getSize().width > MAX_WIDTH) {
    image = image.resize({ width: MAX_WIDTH });
  }
  const out = image.getSize();

  return {
    base64: image.toJPEG(JPEG_QUALITY).toString("base64"),
    mediaType: "image/jpeg",
    width: out.width,
    height: out.height,
    offsetX: regionLogX,
    offsetY: regionLogY,
    scaleX: regionLogW / out.width,
    scaleY: regionLogH / out.height,
    signature: buildSignature(image),
  };
}

/**
 * Capture, then re-capture until two consecutive frames stop differing (or a
 * short cap elapses). Avoids handing the model a half-loaded / spinner frame
 * right after an action that triggered navigation. Only adds latency while the
 * screen is genuinely still changing.
 */
export async function captureStable(
  opts: CaptureOptions = {},
): Promise<Screenshot | { error: string }> {
  let prev = await captureScreen(opts);
  if ("error" in prev) return prev;
  const STEP = 120;
  const CAP_MS = 1000;
  const start = Date.now();
  for (let i = 0; i < 8; i++) {
    await delay(STEP);
    const next = await captureScreen(opts);
    if ("error" in next) return prev;
    if (!framesDiffer(prev.signature, next.signature)) return next;
    prev = next;
    if (Date.now() - start > CAP_MS) return next;
  }
  return prev;
}

/** Map a coordinate in a screenshot's pixel space onto real (logical) display
 *  coordinates the OS input layer expects. */
export function toScreenPoint(
  x: number,
  y: number,
  shot: Pick<Screenshot, "offsetX" | "offsetY" | "scaleX" | "scaleY">,
): { x: number; y: number } {
  return {
    x: Math.round(shot.offsetX + x * shot.scaleX),
    y: Math.round(shot.offsetY + y * shot.scaleY),
  };
}
