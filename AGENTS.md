# OpenDex — agent notes

OpenDex is an **Electron** desktop app (electron-vite + React + Tailwind v4). It is a voice-first agentic harness, generalized from a Next.js demo.

## Process model (important)
- **Main process** (`src/main/`) — Node. Owns the agent loop (`agent/chat.ts`, Vercel AI SDK `streamText`), TTS (`tts/elevenlabs.ts`), API keys, and all IPC handlers (`index.ts`). **Secrets never reach the renderer.**
- **Preload** (`src/preload/`) — `contextBridge` exposes a minimal typed `window.opendex` API (`chat`, `synthesize`). Ambient global in `opendex.d.ts`.
- **Renderer** (`src/renderer/src/`) — React UI + the voice state machine (`lib/dex/use-dex.ts`, hook `useDex`). Talks to main only through `window.opendex`. `@/` aliases `src/renderer/src`. (Note: no `Jarvis` identifiers in code — "Jarvis" is only the name of one theme.)

## Conventions
- Add a new IPC channel: declare it in `src/main/ipc/channels.ts`, handle it in `src/main/index.ts`, expose it in `src/preload/index.ts`, type it in `opendex.d.ts`.
- Main-process runtime deps go in `dependencies` (electron-vite externalizes them; electron-builder ships them). Renderer-only libs (react, etc.) can be `devDependencies` — Vite bundles them.
- Typecheck with `pnpm typecheck`. Smoke-test the agent without Electron: `pnpm smoke:chat [briefing]`.
- Build: `pnpm build` (→ `out/`); run built app: `pnpm start`; package: `pnpm dist`.

## Config (Phase 2)
- `src/main/config/schema.ts` — `OpenDexConfig` shape + `DEFAULT_CONFIG` + `mergeConfig`. Shared types only with the renderer (imported type-only across the process boundary).
- `src/main/config/store.ts` — hand-rolled store: `config.json` (prefs) + `secrets.json` (keys encrypted via `safeStorage`) in `userData`. `applyToEnv()` pushes config + decrypted secrets into `process.env` so agent/TTS read them as before; dev `.env` is a fallback for unset secrets. **Secret values never leave main** — IPC returns only presence booleans (`PublicConfig`).
- Greeting/persona/model are resolved per-turn in the chat handler via `buildSystemPrompt({config, briefing})` (`agent/system-prompt.ts`); greeting modes: `example` (CoreViz) | `custom` | `none`.
- Renderer: `lib/use-config.ts` loads/updates config; `App.tsx` gates on `onboarding.completed` → `OnboardingWizard` else `MainExperience`. TTS engine chosen via `lib/dex/speech-engine.ts` (ElevenLabs vs `SystemSpeechEngine`).

## Themes (Phase 3) — full-interface
- **A theme renders the entire main experience** (visualization + status + transcript + controls), not just the visualizer. Only the settings gear and the audio-unlock overlay live outside the theme, in `App.tsx`. (Letting developers author themes in React is the long-term goal.)
- `components/themes/` — `types.ts` (`DexThemeProps`: full state + `getAmplitude`), `registry.ts` (`getDexTheme` by `appearance.theme`), `theme-picker.tsx`, `minimal-shell.tsx` (shared chrome for the minimal themes). Themes: `jarvis/` (full cyan Stark HUD with animated arc reactor — the one colorful theme), `dot-theme.tsx` and `cursor-theme.tsx` (minimal black/white).
- `App.tsx` picks `getDexTheme(cfg.appearance.theme).Component` and renders it with all of `useDex`'s state.
- Amplitude: `lib/dex/audio-meter.ts` meters the **mic** (real listening loudness, never connected to destination). Speaking/thinking use a synthetic envelope in `use-dex.ts` (no audio routing → no autoplay/silence risk). `useDex().getAmplitude()` returns the status-appropriate 0..1 level; themes sample it via `components/themes/use-amplitude.ts` (rAF → direct DOM writes, no React re-renders).
- To add a theme: implement a `DexThemeProps` component, register it in `registry.ts`. Picker + config wiring are automatic.

## Wake/STT (Phase 4a) — pluggable voice input
- Config `voiceInput: { wakeMode, porcupineKeyword, sttProvider }`. Wake: `manual` (push-to-talk — orb click or ⌘⇧Space global hotkey), `porcupine` (WASM wake word, needs Picovoice key), `webspeech` (continuous scan). STT: `webspeech` (single-shot) or `openai` (cloud Whisper). All pure JS/WASM — no native modules.
- Web Speech + the keyless `manual` path stay inline in `use-dex.ts` (tightly coupled to the state machine). `porcupine` wake and `openai` STT are encapsulated in `lib/dex/engines/` (`porcupine-wake.ts`, `cloud-stt.ts`, `wav.ts`, `types.ts`); `startMode` branches on config.
- Audio: Porcupine + cloud capture use `@picovoice/web-voice-processor` (16kHz Int16 frames) in the renderer. Cloud STT endpoints on silence (energy/RMS), encodes WAV, and sends bytes to main → `src/main/stt/` (OpenAI). **OpenAI key stays main-only**; the **Picovoice AccessKey is the one secret the renderer may read** (`getPicovoiceKey` IPC) because the Porcupine WASM SDK needs it client-side.
- Porcupine English params bundled at `src/renderer/public/models/porcupine_params.pv`; the Porcupine engine is dynamic-imported so its ~3.6MB WASM chunk loads only in `porcupine` mode (main bundle stays ~870KB).
- Manual mode: `useDex().pushToTalk()` + `canPushToTalk`; themes make the visualization tap-to-talk. Global hotkey registered in main (`globalShortcut`) → `push-to-talk` IPC event → `onPushToTalk` (preload) → `pushToTalk()`.

## Status
Phases 1–4a done. **4b** = offline local Whisper (transformers.js). Roadmap: skills+MCP → computer-use → releases. **Default voice input is still Web Speech (unreliable in Electron); switch to "Push to talk + OpenAI Whisper" in Settings/onboarding for reliable desktop voice.**
