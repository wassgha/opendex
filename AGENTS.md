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

## Status
Phases 1–3 done. Roadmap: pluggable wake/STT → skills+MCP → computer-use → releases. **Voice wake/STT uses the Web Speech API today, which is unreliable in Electron (backs off, then surfaces as "unsupported"); local engines land in the wake/STT phase.**
