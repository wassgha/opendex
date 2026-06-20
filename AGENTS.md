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
- `components/themes/` — `types.ts` (`DexThemeProps`: full state + `getAmplitude`), `registry.ts` (`getDexTheme` by `appearance.theme`), `theme-picker.tsx`, `minimal-shell.tsx` (shared chrome: solid bg, header, push-to-talk; `hideTranscript` opt; otherwise a borderless bottom transcript overlay via `overlay-transcript.tsx` that fades older lines). Themes: `jarvis/` (cyan Stark HUD — `jarvis-reactor.tsx` central arc reactor + `hud-widgets.tsx` scattered ring/gauge satellites + amplitude-reactive `HudWaveform`), `dot-theme.tsx` (amplitude dot + overlay transcript), `cursor-theme.tsx` (a single centered line **typed in by the caret** via a `useTypewriter` hook — both user speech and the streamed reply type out next to a blinking cursor; `hideTranscript`).
- `App.tsx` picks `getDexTheme(cfg.appearance.theme).Component` and renders it with all of `useDex`'s state.
- Amplitude: `lib/dex/audio-meter.ts` meters the **mic** (real listening loudness, never connected to destination). Speaking/thinking use a synthetic envelope in `use-dex.ts` (no audio routing → no autoplay/silence risk). `useDex().getAmplitude()` returns the status-appropriate 0..1 level; themes sample it via `components/themes/use-amplitude.ts` (rAF → direct DOM writes, no React re-renders).
- To add a theme: implement a `DexThemeProps` component, register it in `registry.ts`. Picker + config wiring are automatic.

## Wake/STT (Phase 4a) — pluggable voice input
- Config `voiceInput: { wakeMode, porcupineKeyword, sttProvider }`. Wake: `manual` (push-to-talk — orb click or ⌘⇧Space global hotkey), `porcupine` (WASM wake word, needs Picovoice key), `webspeech` (continuous scan). STT: `webspeech` (single-shot) or `openai` (cloud Whisper). All pure JS/WASM — no native modules.
- Web Speech + the keyless `manual` path stay inline in `use-dex.ts` (tightly coupled to the state machine). `porcupine` wake and `openai` STT are encapsulated in `lib/dex/engines/` (`porcupine-wake.ts`, `cloud-stt.ts`, `wav.ts`, `types.ts`); `startMode` branches on config.
- Audio: Porcupine + cloud capture use `@picovoice/web-voice-processor` (16kHz Int16 frames) in the renderer. Cloud STT endpoints on silence (energy/RMS), encodes WAV, and sends bytes to main → `src/main/stt/` (OpenAI). **OpenAI key stays main-only**; the **Picovoice AccessKey is the one secret the renderer may read** (`getPicovoiceKey` IPC) because the Porcupine WASM SDK needs it client-side.
- Porcupine English params bundled at `src/renderer/public/models/porcupine_params.pv`; the Porcupine engine is dynamic-imported so its ~3.6MB WASM chunk loads only in `porcupine` mode (main bundle stays ~870KB).
- Manual mode: `useDex().pushToTalk()` + `canPushToTalk`; themes make the visualization tap-to-talk. Global hotkey registered in main (`globalShortcut`) → `push-to-talk` IPC event → `onPushToTalk` (preload) → `pushToTalk()`.

## Free offline engines (Phase 4b)
- STT providers now also include **`whisper-local`** (transformers.js Whisper, WASM/WebGPU — `engines/whisper-stt.ts`) and **`vosk-local`** (vosk-browser WASM — `engines/vosk-stt.ts`); wake modes include **`vosk`** (free, no-signup, hands-free keyword spotting — `engines/vosk-wake.ts`). All free, offline, no key (one-time model download, cached). `engines/frame-capture.ts` is the shared WVP capture + endpointing helper; `engines/vosk-model.ts` caches the Vosk model.
- All heavy engines are **dynamic-imported** → code-split: main bundle ~900KB; ORT WASM (~23MB), Vosk (~5.8MB), Porcupine (~3.7MB), Whisper glue (~1.2MB) load only when their mode is selected, and are bundled locally (offline-capable). Local STT model is preloaded when entering wake mode so the first capture isn't blocked; `useDex().loadingModel` drives a global download banner in `App.tsx`.
- **CSP note:** Vosk's emscripten WASM requires `'unsafe-eval'` in `script-src` (Porcupine + ORT only need `'wasm-unsafe-eval'`). This is set in `src/renderer/index.html` as a deliberate tradeoff; removing the Vosk engine would let us tighten it back.

## Skills + permission gate (Phase 5a)
- A **skill** (`agent/skills/types.ts`) bundles tools `{ name, description, inputSchema (zod), execute }`; `sensitive: true` routes every call through the permission gate. Built-ins live in `agent/skills/` (currently just `open.ts` — openUrl/openApp/openPath). `registry.ts` `buildToolSet({config, requestPermission})` merges always-on base tools (`agent/tools.ts`) with enabled skills, wrapping sensitive tools' `execute` to `await requestPermission(...)` first.
- **Permission gate** (`agent/permissions.ts`): per-request `makePermissionRequester(sender)` checks the standing decision in `config.skills.permissions[id]` (`always`→run, `never`→deny, else prompt → `permission:request` IPC → renderer overlay → `permission:respond`). `allow_once|always|deny|never`; `always`/`never` persist via `updateConfig`. The `chatStart` handler builds tools per-turn with a sender-bound requester.
- Config: `skills: { enabled, permissions }`. Renderer: `components/permission-prompt.tsx` overlay + `lib/use-permission.ts` (queues prompts), rendered as global chrome in `App.tsx`; Settings "Skills & tools" section (enable toggle + Ask/Always/Never) driven by renderer-safe `lib/skills-meta.ts` (kept in sync with the main registry, since the renderer can't import the electron-backed skills).
- **5b (next):** MCP client (`@modelcontextprotocol/sdk`, stdio servers, config-driven mounting), more built-ins (shell, filesystem, clipboard), user skills dir.

## Status
Phases 1–4 done (4a cloud/web + 4b free offline); **5a done** (skill system + permission gate + Open-apps/URLs built-in). Roadmap: 5b MCP + more built-ins → computer-use → releases.
