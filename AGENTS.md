# OpenDex — agent notes

OpenDex is an **Electron** desktop app (electron-vite + React + Tailwind v4). It is a voice-first agentic harness, generalized from a Next.js demo.

## Process model (important)
- **Main process** (`src/main/`) — Node. Owns the agent loop (`agent/chat.ts`, Vercel AI SDK `streamText`), TTS (`tts/elevenlabs.ts`), API keys, and all IPC handlers (`index.ts`). **Secrets never reach the renderer.**
- **Preload** (`src/preload/`) — `contextBridge` exposes a minimal typed `window.opendex` API (`chat`, `synthesize`). Ambient global in `opendex.d.ts`.
- **Renderer** (`src/renderer/src/`) — React UI + the voice state machine (`lib/jarvis/use-jarvis.ts`). Talks to main only through `window.opendex`. `@/` aliases `src/renderer/src`.

## Conventions
- Add a new IPC channel: declare it in `src/main/ipc/channels.ts`, handle it in `src/main/index.ts`, expose it in `src/preload/index.ts`, type it in `opendex.d.ts`.
- Main-process runtime deps go in `dependencies` (electron-vite externalizes them; electron-builder ships them). Renderer-only libs (react, etc.) can be `devDependencies` — Vite bundles them.
- Typecheck with `pnpm typecheck`. Smoke-test the agent without Electron: `pnpm smoke:chat [briefing]`.
- Build: `pnpm build` (→ `out/`); run built app: `pnpm start`; package: `pnpm dist`.

## Config (Phase 2)
- `src/main/config/schema.ts` — `OpenDexConfig` shape + `DEFAULT_CONFIG` + `mergeConfig`. Shared types only with the renderer (imported type-only across the process boundary).
- `src/main/config/store.ts` — hand-rolled store: `config.json` (prefs) + `secrets.json` (keys encrypted via `safeStorage`) in `userData`. `applyToEnv()` pushes config + decrypted secrets into `process.env` so agent/TTS read them as before; dev `.env` is a fallback for unset secrets. **Secret values never leave main** — IPC returns only presence booleans (`PublicConfig`).
- Greeting/persona/model are resolved per-turn in the chat handler via `buildSystemPrompt({config, briefing})` (`agent/system-prompt.ts`); greeting modes: `example` (CoreViz) | `custom` | `none`.
- Renderer: `lib/use-config.ts` loads/updates config; `App.tsx` gates on `onboarding.completed` → `OnboardingWizard` else `MainExperience`. TTS engine chosen via `lib/jarvis/speech-engine.ts` (ElevenLabs vs `SystemSpeechEngine`).

## Status
Phases 1–2 done. Roadmap: voice-viz themes → pluggable wake/STT → skills+MCP → computer-use → releases. **Voice wake/STT uses the Web Speech API today, which is unreliable in Electron (backs off, then surfaces as "unsupported"); local engines land in the wake/STT phase.**
