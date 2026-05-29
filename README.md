# Jarvis

A voice-first agentic assistant. Wake word ("Jarvis") triggers active listening; an LLM agent with tools (time, weather, web search) generates a reply that streams back through an ElevenLabs British voice.

## Stack

- **Next.js 16** + React 19 + Tailwind CSS 4 (Turbopack)
- **Vercel AI SDK v6** with the Vercel AI Gateway — defaults to `anthropic/claude-sonnet-4-6`
- **ElevenLabs** streaming TTS (`eleven_turbo_v2_5`, defaults to the "George" voice)
- **Web Speech API** for wake-word + speech-to-text (Chrome / Edge / Safari only)

## Quick start

```bash
cp .env.local.example .env.local
# fill in ELEVENLABS_API_KEY, AI_GATEWAY_API_KEY, optionally TAVILY_API_KEY

pnpm install
pnpm dev
```

Open <http://localhost:3000>, click **Engage**, grant microphone permission, then say:

> Jarvis, what's the weather in London?

## How it works

The client (`lib/jarvis/use-jarvis.ts`) owns a small state machine:

```
idle → listening_wake → active_listening → thinking → speaking → listening_wake
```

- `listening_wake`: continuous `SpeechRecognition` scanning for `/\bjarvis\b/i`.
- `active_listening`: single-shot recognition with silence + hard timeouts. If the user spoke the command in the same breath as the wake word, that flow is short-circuited.
- `thinking`: posts the running message history to `/api/chat` (server-side `streamText` with tools). Text deltas stream back as plain text.
- `speaking`: tokens are fed into `sentence-buffer.ts` which flushes on sentence boundaries to `/api/tts` for ElevenLabs synthesis. Audio clips play in FIFO order via `tts-player.ts`.

## Tools available to the agent

Defined in `lib/ai/tools.ts`:

- `getCurrentTime({ timezone })` — IANA timezone, defaults to UTC
- `getWeather({ location })` — Open-Meteo (no API key)
- `webSearch({ query })` — Tavily (requires `TAVILY_API_KEY`)

## Environment variables

| Var | Required | Default |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes | — |
| `ELEVENLABS_VOICE_ID` | no | `JBFqnCBsd6RMkjVDRZzb` (George) |
| `ELEVENLABS_MODEL_ID` | no | `eleven_turbo_v2_5` |
| `AI_GATEWAY_API_KEY` | yes (locally) | uses Vercel OIDC when deployed |
| `JARVIS_MODEL` | no | `anthropic/claude-sonnet-4-6` |
| `TAVILY_API_KEY` | no | web search disabled if absent |

## Browser support

Web Speech API is required. Works in Chrome, Edge, and recent Safari. Firefox is unsupported — the UI surfaces a clear notice.

## Deploy

```bash
pnpm dlx vercel deploy
```

Set the env vars above in the Vercel project. Next.js is auto-detected and `vercel.ts` is applied.
