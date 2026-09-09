# Interaction recordings

Open Settings → Recordings (also available from the tray menu). Choose a display,
leave Microphone and System audio checked to include both sides of the conversation,
then press Start recording before waking Dex. Stop in Settings or the tray menu.
The tray displays REC while capture is active. Closing Settings hides its window
during recording so it can keep capturing while Dex works in other apps.

Saved recordings appear below the controls. Select one for playback, export a copy
through the save dialog, show the original file, or move it to the system Trash.
Export does not upload or publish anything. There is no automatic recording.

Capture includes the selected screen and its notifications. System audio includes
other apps. Use headphones to minimize microphone pickup of speaker playback.
Recordings are stored under Electron userData/recordings, normally
`~/Library/Application Support/opendex/recordings`, with private file permissions.
Each clip has a JSON sidecar. Do not commit or upload these files as diagnostics.
Recordings stop at thirty minutes or two gigabytes; existing clips remain until
the user removes them. There is no automatic deletion of older recordings.

The encoder prefers MP4 with H.264/AAC and falls back to another supported MP4 or
WebM format. Export keeps the recorded format. Interrupted clips are preserved
when possible, but a crash can leave an incomplete, unplayable video. Ordinary
quit requests give the renderer up to eight seconds to flush the final chunk.

## Implementation

- `src/main/recordings/host.ts` owns IPC, display grants, the library, export and
  the streaming playback protocol. Only the Settings renderer can begin or write
  a recording. A display grant is scoped to that recording and consumed once.
- `store.ts` serializes bounded writes and persists metadata. Renderer chunks
  arrive once a second; recordings are never accumulated as a single RAM blob.
- The Settings renderer owns `lib/recordings/recorder.ts`, separate from the voice
  session. It mixes system audio and a dedicated microphone stream into one track,
  without routing that mix to speakers. Cleanup releases only its own resources.
- Pending capture requests can be cancelled or time out; late streams are stopped.
  No voice model, diagnostic transcript, API key, or screenshot tool is involved.
- Playback uses a restricted `opendex-recording://video/<id>` URL with byte ranges.

macOS requires screen/audio capture permission. Packaged builds include
NSAudioCaptureUsageDescription; launching from a development host may also depend
on that host's permission configuration. See the official
[Electron capture notes](https://www.electronjs.org/docs/latest/api/desktop-capturer).
The local macOS capture path has been exercised; Windows and Linux still require
live platform validation. System audio defaults off on Linux.

## Checks

`node_modules/.bin/tsx --test scripts/test-recording-store.ts scripts/test-recording-capture.ts`
checks ordered writes, interrupted recovery, cancellation, timeout, late-stream
cleanup, file permissions, ID validation, and trash routing.

## Quick controls

The notch has an always-visible record circle that becomes a stop square during
capture. Say “Dex, start recording” or “Dex, stop recording” for the same controls
in pipeline or realtime voice mode. The Interaction recording skill can be disabled
for voice; the manual notch stop remains available. No demo starts capture on its own.

Quick start reuses the last screen, microphone, and system-audio choices in Settings.
Initially it uses the first available display, microphone on, and system audio on
(except Linux). If a saved display is disconnected, it uses the first available
display. The settings renderer can start hidden and owns the capture throughout.
Start returns actual capture readiness; stop flushes and saves asynchronously.
