import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// electron-vite auto-detects entry points from the conventional locations:
//   src/main/index.ts · src/preload/index.ts · src/renderer/index.html
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
        // Skills live outside the renderer tree (src/skills) because each one is
        // a self-contained folder spanning the process boundary — the renderer
        // imports only the UI half (view.tsx / metas / tool-card-layer).
        "@skills": resolve(__dirname, "src/skills"),
      },
    },
    // Pin the dev origin. The local STT models (transformers.js / Vosk) cache in
    // the renderer's Cache API keyed by origin; if the port drifts (e.g. 5173 is
    // busy and Vite bumps to 5174) the cache is orphaned and the model
    // re-downloads. strictPort keeps the origin stable — and fails loudly if a
    // stale dev instance is already running, instead of silently bumping.
    server: {
      port: 5173,
      strictPort: true,
    },
    plugins: [react(), tailwindcss()],
  },
});
