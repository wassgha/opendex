// Ambient global so the renderer is fully typed against window.opendex.
import type { OpenDexApi } from "./index";
import type { WidgetApi } from "./widget";

declare global {
  interface Window {
    opendex: OpenDexApi;
    /** Only independent widget windows expose this minimal bridge. */
    opendexWidget: WidgetApi;
  }
}

export {};
