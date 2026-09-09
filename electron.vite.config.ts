import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const vadDir = dirname(require.resolve("@ricky0123/vad-web"));
const ortDir = dirname(createRequire(require.resolve("@ricky0123/vad-web")).resolve("onnxruntime-web/wasm"));
const vadAssets = new Map([
  ["silero_vad_v5.onnx", resolve(vadDir, "silero_vad_v5.onnx")],
  ["vad.worklet.bundle.min.js", resolve(vadDir, "vad.worklet.bundle.min.js")],
  ["ort-wasm-simd-threaded.mjs", resolve(ortDir, "ort-wasm-simd-threaded.mjs")],
  ["ort-wasm-simd-threaded.wasm", resolve(ortDir, "ort-wasm-simd-threaded.wasm")],
]);

// electron-vite auto-detects entry points from the conventional locations:
//   src/main/index.ts · src/preload/index.ts · src/renderer/index.html
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          widget: resolve(__dirname, "src/preload/widget.ts"),
        },
      },
    },
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
    plugins: [react(), tailwindcss(), {
      name: "local-speech-detector-assets",
      generateBundle() {
        for (const [name, path] of vadAssets) this.emitFile({ type: "asset", fileName: `vad/${name}`, source: readFileSync(path) });
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const name = req.url?.split("?")[0]?.replace(/^\/vad\//, "");
          const path = name && vadAssets.get(name);
          if (!path || !req.url?.startsWith("/vad/")) return next();
          res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".onnx") ? "application/octet-stream" : "text/javascript");
          res.end(readFileSync(path));
        });
      },
    }],
  },
});
