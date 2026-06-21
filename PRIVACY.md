# Privacy

OpenDex is a local-first desktop app. Your API keys are encrypted in your OS
keychain and never leave the main process, and your voice, transcripts, prompts,
and the model's replies are sent only to the LLM/voice providers **you**
configure — never to us.

## Anonymous usage analytics

To understand how OpenDex is used and where to improve it, the app sends a small
amount of **anonymous** usage data via Google Analytics 4. This is **on by
default** and you can turn it off at any time:

- During first-run onboarding (the "Share anonymous usage data" checkbox), or
- Later in **Settings → Privacy → Anonymous usage data**.

When off, nothing is sent.

### What is collected

Events are tied to a random identifier generated on your device
(`analytics-client-id` in the app's data folder). It is **not** linked to your
name, email, IP-based identity, or any account.

| Event | Data |
| --- | --- |
| `app_started` / `app_quit` | app version, OS platform, CPU arch |
| `onboarding_started` / `onboarding_completed` | plus chosen theme, wake mode, STT provider, TTS engine, greeting mode (the *option names* only) |
| `command_run` | whether it was a normal command or the example briefing |
| `tool_used` | the tool's **name** only (e.g. `openUrl`, `click`) |
| `update_downloaded` | the new version string |

Every event also carries the common fields above (app version / OS / arch) and a
per-launch session id.

### What is **never** collected

- Voice audio, transcripts, or anything you say
- Your prompts or the model's replies
- API keys or secrets of any kind
- URLs you open, file paths, or file contents
- Tool **arguments** (only the tool name is recorded)
- Your name, email, or any account identifier

### How it works

Analytics are sent from the main process using the GA4 Measurement Protocol over
HTTPS, fire-and-forget — they never block or affect the app. The relevant code
is in [`src/main/analytics/index.ts`](src/main/analytics/index.ts), and every
call site is a `track(...)` you can audit in the source.

## Auto-updates

OpenDex checks GitHub Releases for new versions on launch and hourly. This is a
request to GitHub's servers and is subject to GitHub's privacy policy.
