# OpenDex

An open-source, **voice-first agentic harness** for the desktop. Wake it, speak, and a tool-using LLM agent replies aloud — with everything (LLM, voice, visualization theme, greeting, skills) configurable. Built on Electron.

> Status: **Phase 1 of 7** complete — the Electron shell + secure agent/TTS-over-IPC architecture. See `docs`/`AGENTS.md` for the roadmap (config & onboarding → voice-viz themes → pluggable wake/STT → skills + MCP → computer-use → signed releases).

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

Environment (`.env`, dev only — Phase 2 moves keys to the OS keychain):

| Var | Required | Default |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes (for TTS) | — |
| `ELEVENLABS_VOICE_ID` | no | `JBFqnCBsd6RMkjVDRZzb` (George) |
| `AI_GATEWAY_API_KEY` | yes | — |
| `OPENDEX_MODEL` | no | `anthropic/claude-sonnet-4-6` |
| `TAVILY_API_KEY` | no | web-search tool disabled if absent |

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
