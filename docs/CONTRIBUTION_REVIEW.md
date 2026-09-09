# Contribution review guide

This contribution combines voice and desktop reliability fixes with new recording,
research, usage, demo, and local-agent workflows. It is based on upstream v1.1.14
(`3e89834`). The feature areas below share the main IPC host, preload contract,
voice hook, and tool registry; review those integration points after the modules.

## Scope and suggested review order

| Area | Resulting behavior | Start here | Regression coverage |
| --- | --- | --- | --- |
| Voice lifecycle and wake | Release/reacquire the mic; retain wake audio; add a wake cue, follow-up listening, sleep/new-session controls, and live input previews. | `lib/dex/use-dex.ts`, `engines/wake-audio.ts`, `engines/vosk-wake.ts` in the renderer | `test-live-microphone`, `test-wake-*`, `test-realtime-idle`, `test-new-session-command`, `test-input-preview` |
| Realtime response ownership | Coordinate responses and tool continuations; wait for confirmed spoken input; preserve work through incidental speech and status questions; cancel superseded desktop work. | `src/main/agent/realtime/session-host.ts`, `response-coordinator.ts`, `confirmed-speech.ts`, `playback-speech-evidence.ts` | `test-spoken-turn-*`, `test-response-coordinator`, `test-confirmed-speech`, `test-playback-*`, `test-desktop-execution` |
| Realtime connection and recovery | Add direct OpenAI voice; show actionable provider failures; buffer early errors until the preload subscribes. | `realtime/connection.ts`, `openai-codec.ts`, `notice-buffer.ts`; renderer `realtime-session.ts`, `voice-error.ts` | `test-openai-realtime`, `test-realtime-feedback` |
| Screen and app controls | Recover from missing screen access; opt-in wake observation; fresh screen descriptions; reference-based zoom; direct macOS window, volume, activation, and normal quit controls. | `src/skills/computer/`, `src/skills/open/`, `src/native/`; main and renderer screen-health modules | `test-screen-on-wake`, `test-direct-controls`, `test-open-url`, `test-quit-app`, `test-verified-activation` |
| Permissions and tools | Share concurrent skill prompts within one command; preserve cancellation and standing denial; confirm Git mutations individually; advertise only usable search capabilities. | `src/main/agent/permissions.ts`, `src/skills/registry.ts`, `availability.ts`, `git/`, `web-search/` | `test-permission-deferral`, `test-enhancement-permissions`, `test-git-skill`, `test-search-availability` |
| Research and task narration | Show plans, sources, findings, and gaps; coordinate one browser worker; require visible source-link navigation; budget research separately; surface stalled/empty results and concise email overviews. | `src/skills/research/`, `src/main/agent/research-*`, `browser-research-policy.ts`, `email-overview.ts`, `model-wait.ts` | `test-research*`, `test-browser-research-policy`, `test-email-overview`, `test-empty-chat`, `test-model-wait` |
| Recordings | Explicit screen/mic/system-audio recording, local library, playback, export, Trash, and quick controls. | `src/main/recordings/`, renderer `lib/recordings/`, `src/skills/recording/` | `test-recording-store`, `test-recording-capture` |
| Usage | Persist per-request usage and estimated/reported costs, including incomplete and unpriced requests; show launch/day totals and Settings history. | `src/main/usage/`, renderer `usage-section.tsx`, `spending-meter.tsx` | `test-usage`; separate `test-usage-desktop.mjs` |
| Diagnostics and local agents | Inspect local interactions and latency; discover/read Codex tasks; permission-gated task dispatch/update/revise/archive and source enhancement. | `src/main/diagnostics/`, `src/main/maintenance/`, skills `diagnostics/`, `local-agents/`, `local-agent-actions/`, `self-enhancement/`, `capabilities/` | `test-diagnostic-*`, `test-interaction-log`, `test-latency-summary`, `test-local-*`, `test-desktop-bridge`, `test-session-control`, `test-self-enhancement` |
| Demos and source walkthroughs | Choose eligible tool-backed demos, show a local particle playground, open the app's source in an editor, and navigate a code walkthrough. | `src/skills/tricks/`, `src/main/demos/`, `src/skills/open/code-walkthrough.ts` and `walkthrough-*` | `test-tricks`, `test-open-source`, `test-code-walkthrough` |
| Compact UI and widgets | Improve transcript wrapping, playback captions, mic/progress/error feedback, button targets and tray visibility; detach widgets into explicit exclusive desktop slots. | renderer `compact-bar.tsx`, `NotchApp.tsx`, themes; `src/main/widgets/`, `src/preload/widget.ts` | `test-widget-magnets`, `test-playback-captions`; separate `test-widgets-desktop.mjs` |
| Browser benchmark | Run three local fixture tasks, persist verified results/baselines, surface inconsistent or failed writes, and cancel bound workers on timeout. | `src/main/benchmarks/`, `src/skills/benchmark/`, `benchmarks/browser/golden.json` | `test-browser-benchmark`, `test-browser-research-policy` |
| Build and small fixes | Bundle speech detector assets, compile the macOS addon, add a restricted widget preload, fix pnpm workspace configuration, and use the local timezone for unspecified clock requests. | `electron.vite.config.ts`, `scripts/build-window-control.mjs`, `pnpm-workspace.yaml`, `src/skills/clock/` | `test-clock`, typecheck, production build |

Test names above are files under `scripts/` with the `.ts` extension unless noted.
Renderer paths abbreviated in the table are under `src/renderer/src/`. Tests mix
pure logic, source assertions, and mocked hosts; passing them is not equivalent
to a live model, microphone, browser, or desktop integration trial.

## Setup and compatibility

Install with the declared pnpm version (10.8.1), then run `pnpm install
--frozen-lockfile`. Existing configuration merges the new `computer.screenOnWake`
field as `false`; pipeline and gateway defaults are retained. Direct OpenAI voice
is an explicit Settings choice using the existing OpenAI key. The configured
language model still handles delegated desktop work.

Diagnostics, local-agent discovery/actions, and self-enhancement skills are opt-in.
Other new skills use the existing enablement and permission conventions. Turning
off the Diagnostics skill does **not** disable local transcript storage. Screen
observation on wake is off by default and requires the existing computer access.
Recording begins only through an explicit control or command.

On macOS, building now requires Xcode command-line tools for the Node-API window
control addon. Other platforms skip native compilation. New runtime dependency:
`@ricky0123/vad-web`; new build dependency: `node-api-headers`. Speech detector and
ONNX runtime assets are bundled for local use. The addon is unpacked from ASAR.
See [native controls](../src/native/README.md) before packaging for another Mac
architecture. No release/version bump is included.

## Data and review-sensitive behavior

| Data or integration | Behavior and limitation |
| --- | --- |
| Diagnostic history | **Automatically stores conversation transcripts locally**, with best-effort secret redaction and approximately 15 MB rotation. No opt-out/delete UI yet. Permissioned diagnosis can pass history to the chosen model. See [diagnostics](SELF_HEALING.md). |
| Video recordings | Explicit start; local screen/audio files; manual export and deletion; capture duration/size caps. See [recordings](RECORDINGS.md). |
| Usage journal | Local counters and cost metadata, without prompts/media; append-only and replayed in memory. No pruning, budget enforcement, or invoice reconciliation. See [usage](USAGE_AND_COSTS.md). |
| Local-agent bridge | Reads selected local task history and can dispatch work after permission. macOS desktop mutations are restricted to one tested version/build; private IPC compatibility is a maintenance risk. |
| Research policy | Source pages must be reached through visible links; several URL/clipboard/search-API shortcuts are blocked during research. This is a deliberate workflow restriction requiring product review. |
| Voice interruption | Confirmed transcription avoids false interruption but adds latency. English transcription is explicit. Mic forwarding stays continuous; speech classification is diagnostic-only. |
| Model work and costs | Research can use 96 steps instead of the ordinary 40. Screen descriptions and local-agent tasks may incur separate model usage; the ledger cannot observe external-agent billing. |

## Validation

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` resolves Electron before starting parallel test workers, avoiding
competing binary extraction on a fresh install. It includes every
`scripts/test-*.ts` file. CI runs the same test entry point, typecheck, and build.
No paid provider request is needed for this suite. Individual `test:*` scripts
remain available for focused iteration.

Optional isolated desktop checks after building:

```sh
node scripts/test-usage-desktop.mjs
node scripts/test-widgets-desktop.mjs
```

These launch real Electron windows with temporary profiles and synthetic data.
They do not prove real provider accounting or acoustic behavior. Live provider
smoke tests (`pnpm smoke:chat`, `pnpm smoke:realtime`) require configured keys and
may incur charges. Do not attach private diagnostic logs or recordings to a PR.

Submission checks on macOS arm64, Node 25.6.1, and pnpm 10.8.1:

- Frozen-lockfile install, typecheck, and production/native build passed.
- All 307 regression tests passed with no skipped tests.
- Both isolated Electron harnesses (usage and widgets) passed.
- No paid-provider smoke test or live acoustic test was run for this submission.
- Linux CI uses Node 22; that environment has not been reproduced locally.

Build warnings include
mixed static/dynamic imports, large renderer chunks, and deprecated macOS app
lookup. Signing/notarization, cross-architecture packaging, Windows/Linux runtime,
provider billing agreement, and final combined-branch acoustic acceptance remain
unverified. Treat this as a broad contribution for review, not a release claim.

## Manual acceptance checklist

1. Start with both fresh and existing profiles. Confirm provider selection,
   screen-access recovery, and opt-in defaults; never copy a personal profile.
2. Test wake, follow-up, sleep, Stop, new session, real interruption, and a status
   question during a tool task. Confirm one reply and no abandoned worker.
3. Exercise a provider startup failure and an in-session failure; verify visible
   recovery text in both main and notch. Restore a usable provider and verify a
   successful audible response. Repeated failure must not replay work.
4. Exercise Allow once, Always, Deny, Never, parallel calls, and cancellation.
   Confirm a denied tool cannot run and a new command has fresh session scope.
5. Record a short clip explicitly, stop, play, export, and Trash it. Verify the
   indicator, window-close behavior, and incomplete-save handling.
6. Inspect usage with reported and unknown costs. Review transcript-storage
   defaults before enabling this build for general distribution.
7. Research through visible browser links, interrupt it, and confirm source
   cards and final report agree with visited evidence. Complete a benchmark and
   repeat under the same conditions; compare persisted rows with its summary.
8. Verify widget slot conflicts, detach/close, resizing, displays, and app quit.
   Test native controls with an app that can reject a resize or quit request.
9. On the supported Codex desktop version, verify discovery, exact task targeting,
   create/follow/result, revision, and archive rejection. Tests with mocked IPC
   alone cannot satisfy this gate.

Further feature details: [confirmed voice turns](VOICE_TURN_CONFIRMATION.md),
[research](RESEARCH.md), [demos](COOL_TRICKS.md), and
[browser benchmark](BROWSER_BENCHMARK.md).
