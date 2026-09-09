# Diagnostics and local agent integration

This guide describes the contribution's current behavior and acceptance gates.
Development-session journals and private interaction histories are not included.
See [the contribution review guide](CONTRIBUTION_REVIEW.md) for scope and checks.

## Inspecting an interaction

Run `pnpm diagnose` for the latest interaction, or `pnpm diagnose -- --last 3`
to compare recent sessions. `pnpm dex:doctor` inspects local agent availability;
`pnpm diagnose:latency` reads aggregate latency measurements. Missing credentials,
permissions, provider credits, and unsupported adapters are setup blockers, not
proof that application code needs modification. Generated assistant text is not
proof that playback completed; compare playback and interruption events.

Interaction history is initialized at application startup, independently of the
opt-in Diagnostics skill. It contains user/assistant transcripts, response/tool
identifiers, timing, and playback events. It does not store audio or screenshots.
It rotates across three approximately 5 MB files in `userData/diagnostics`.
Pattern-based credential redaction is best effort: ordinary personal information
in spoken text can remain. There is currently no recording opt-out or deletion
UI for this transcript history. Quit Dex before manually removing the diagnostic
files. This default requires maintainer review before release; it is separate
from anonymous analytics and manual video recording.

Do not upload or commit runtime history. The Diagnostics skill can return history
to the selected model after its normal permission gate; local storage alone does
not mean a diagnostic request remains entirely on-device. Aggregate latency files
exclude conversation content, but do not independently separate every permission
wait or overlapping operation. They cannot establish a speed improvement alone.

## Local agents and source changes

The read-only local-agent inventory, task actions, and self-enhancement skills are
opt-in and permission-gated. The desktop adapter currently supports macOS and
checks app version `26.901.51231`, build `8109`, before using the local socket.
It validates socket ownership and rejects unknown versions. This is a version-
specific integration, not a stable public API or general compatibility promise.
The CLI/history adapter and desktop task adapter expose different capabilities;
missing live desktop access must not be presented as successful task control.

Self-enhancement prepares reviewable source changes through an available local
agent. It does not automatically install, restart, deploy, or activate those
changes. Task follow-up, revise, and scrap actions must resolve an actual target;
archive fallback uses the existing permission-gated desktop worker. Repository
Git operations have their own permission and per-action confirmation rules.

## Acceptance gates

- Run relevant regression tests, `pnpm typecheck`, and `pnpm build`.
- A desktop integration milestone requires a real create/follow/result round
  trip in the supported app; mocked transport tests are insufficient.
- A voice milestone requires a real microphone, audible output, and interruption
  trial with a usable provider. Provider rejection is not a successful voice test.
- Loading a source change and observing the changed behavior are separate gates.
- Record only a concise behavior summary, validation, limits, and next action.
  Keep raw runtime logs and conversation content out of this document.

Prior local development verified that an early provider failure can reach the
notch recovery UI. Successful acoustic acceptance of the final combined branch,
full browser benchmark completion, provider billing reconciliation, signed
packages, and Windows/Linux behavior remain unverified for this submission.
No live milestone is marked complete by the automated submission checks.
