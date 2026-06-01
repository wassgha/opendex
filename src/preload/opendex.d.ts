// Ambient global so the renderer is fully typed against window.opendex.
import type { OpenDexApi } from "./index";

declare global {
  interface Window {
    opendex: OpenDexApi;
  }
}

export {};
