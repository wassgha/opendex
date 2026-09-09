import { nativeImage } from "electron";

/** Three small waves matching the app's wordmark, with Retina representations.
 * Template images use alpha only: macOS supplies the menu-bar foreground color. */
export function createTrayIcon() {
  const draw = (scale: number) => {
    const size = 18 * scale;
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let covered = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const px = (x + (sx + 0.5) / 4) / scale;
          const py = (y + (sy + 0.5) / 4) / scale;
          const curveX = Math.max(2.5, Math.min(15.5, px));
          const wave = 1.1 * Math.sin((curveX - 2.5) * Math.PI / 6.5);
          if ([5, 9, 13].some((row) => Math.hypot(px - curveX, py - row - wave) <= 0.8)) covered++;
        }
        const offset = (y * size + x) * 4;
        const color = process.platform === "darwin" ? 0 : 255;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = color;
        pixels[offset + 3] = Math.round(covered / 16 * 255);
      }
    }
    return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: scale });
  };
  const icon = draw(1);
  icon.addRepresentation({ scaleFactor: 2, buffer: draw(2).toPNG() });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  return icon;
}
