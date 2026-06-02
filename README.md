# OpenDex

An open-source, **voice-first agentic harness** for the desktop. Wake it, speak, and a tool-using LLM agent replies aloud — with everything (LLM, voice, visualization theme, greeting, skills) configurable. Built on Electron.

> Status: **Phases 1–3 of 7** complete — the Electron shell + secure agent/TTS-over-IPC architecture; a full config system (first-run onboarding, settings, OS-keychain-encrypted keys, configurable model/voice/greeting/wake-word, ElevenLabs-or-system-TTS); and selectable **full-interface themes** (a cinematic Jarvis HUD with an animated arc reactor, plus minimal Talking Dot and Typing Cursor) that react to mic loudness. Remaining roadmap: pluggable wake/STT → skills + MCP → computer-use → signed releases. See `AGENTS.md`.

## Stack

- **Electron** + **electron-vite** (main / preload / renderer)
- **React 19** + **Tailwind CSS 4** renderer
- **Vercel AI SDK v6** agent loop in the main process (defaults to `anthropic/claude-sonnet-4-6` via the AI Gateway)
- **ElevenLabs** streaming TTS (`eleven_turbo_v2_5`, "George" voice by default)
- API keys live only in the main process — never in the renderer.

## Architecture

```
Renderer (React) ──window.opendex──▶ Preload (contextBridge) ──IPC──▶ Main (Node)
  state machine, UI                    typed bridge                   agent loop · TTS · keys
```

The renderer asks the main process to `chat()` (streamed text deltas) and `synthesize()` (MP3 bytes); secrets stay in main. See `AGENTS.md` for the process model and how to add IPC channels.

## Quick start

```bash
cp .env.local.example .env       # fill in keys (see below)
pnpm install
pnpm dev                         # launches the OpenDex desktop window
```

Keys & preferences are configured in-app: a **first-run onboarding wizard** and the **Settings** panel (⚙) collect the AI Gateway key, model, TTS engine + voice, greeting, and wake word. API keys are encrypted with your OS keychain (`safeStorage`) and never reach the renderer.

For development you can still seed values via `.env` (used as a fallback for any unset key):

| Var | Notes |
|---|---|
| `AI_GATEWAY_API_KEY` | required to think/reply |
| `ELEVENLABS_API_KEY` | required for ElevenLabs TTS (not needed for system voice) |
| `ELEVENLABS_VOICE_ID` / `OPENDEX_MODEL` / `TAVILY_API_KEY` | optional overrides |

## Scripts

- `pnpm dev` — run the app with HMR
- `pnpm build` — build main/preload/renderer into `out/`
- `pnpm start` — run the built app
- `pnpm dist` — package installers via electron-builder (mac/win/linux)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm smoke:chat [briefing]` — exercise the main-process agent without Electron

## Known limitation (Phase 1)

Wake-word + speech-to-text currently use the browser **Web Speech API**, which depends on a remote service that is **unavailable inside Electron** — so voice input surfaces as "unsupported" for now. The pluggable local wake/STT engines (Picovoice + Whisper) land in a later phase. The agent and TTS pipeline are fully functional today (verify with `pnpm smoke:chat`).

## License

MIT (see `LICENSE`).
