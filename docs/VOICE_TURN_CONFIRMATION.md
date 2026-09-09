# Confirmed spoken turns

OpenAI realtime sessions use semantic VAD with `create_response: false` and
`interrupt_response: false`. `confirmedTurnOptions` supplies the full provider
`audio` object because the gateway's OpenAI adapter merges provider options
shallowly. PCM rate, output voice, and English input transcription are preserved.

Tentative speech-started/stopped events are logged but do not flush playback,
cancel generation, advance the tool epoch, or close the session. A matching,
nonempty final transcript confirms the next user turn. Main then interrupts
playback/generation and asks ResponseCoordinator for one response after the
previous generation finishes. Empty or timed-out transcriptions are discarded;
late or superseded transcripts cannot authorize a newer turn. Microphone frames
continue flowing exactly once; local speech detection remains diagnostic-only.

This conservative policy adds transcription latency to voice interruptions.
Stop and the global interrupt shortcut still act immediately. Other providers
retain their existing server turn detection behavior.

Validation on 2026-09-08: 29 targeted tests passed, TypeScript checking passed,
and Electron production build passed. Host tests reproduce an empty speech
event during a valid reply, preserve a delegated research tool through noise,
and verify that a real confirmed interruption waits for cancellation completion.
The read-only Electron probe (`scripts/probe-confirmed-turns.cjs`) connected to
the configured provider and observed both turn-detection flags acknowledged as
false. It sends no microphone audio or user text. A live microphone interaction
has not yet verified the acoustic behavior of this revision.

Official semantics: https://developers.openai.com/api/docs/guides/realtime-vad

Isolated non-command vocalizations (for example Hmm, um, uh, erm) are now ignored
while playback, generation, or a current delegated task is active. This check
runs before response cancellation and does not change the tool epoch. Real
short commands, yes/no, and longer corrections remain eligible. Diagnostics
record incidental-speech-ignored without claiming what acoustically caused it.
