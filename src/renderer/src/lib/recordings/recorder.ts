import { MAX_RECORDING_MS, RECORDING_MIMES, type RecordingOptions } from "../../../../main/recordings/types";
import { acquireCapture } from "./acquire-capture";

/** One recorder in the Settings renderer, independent of the selected section. */
class InteractionRecorder {
  private busy = false;
  private cancelled = false;
  private startup: AbortController | null = null;
  private recorder: MediaRecorder | null = null;
  private streams: MediaStream[] = [];
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private error: string | undefined;
  private check() { if (this.cancelled) throw new Error("Recording cancelled."); }

  async start(options: RecordingOptions) {
    if (this.busy) throw new Error("A recording is already active.");
    const mime = RECORDING_MIMES.find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error("This version of Electron cannot encode a supported video format.");
    this.busy = true; this.cancelled = false; this.error = undefined;
    const startup = this.startup = new AbortController();
    let id: string | undefined;
    try {
      id = await window.opendex.recordingPrepare(options, mime);
      this.check();
      const display = await acquireCapture(navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { max: 1920 }, height: { max: 1080 } },
        audio: options.systemAudio,
      }), startup.signal, "Screen and audio capture");
      this.streams.push(display); this.check();
      if (options.systemAudio && !display.getAudioTracks().length) throw new Error("System audio was not granted. Check Screen & System Audio Recording in system settings, or turn off System audio and try again.");
      let mic: MediaStream | undefined;
      if (options.microphone) {
        mic = await acquireCapture(navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }), startup.signal, "Microphone capture");
        this.streams.push(mic); this.check();
      }
      const tracks = [...display.getVideoTracks()];
      if (display.getAudioTracks().length || mic) {
        const context = this.context = new AudioContext();
        const mix = context.createMediaStreamDestination();
        const limiter = context.createDynamicsCompressor();
        limiter.connect(mix);
        for (const stream of [display, mic]) {
          if (!stream?.getAudioTracks().length) continue;
          const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
          const gain = context.createGain(); gain.gain.value = 0.85;
          source.connect(gain).connect(limiter);
        }
        await context.resume(); this.check();
        tracks.push(...mix.stream.getAudioTracks());
        this.streams.push(mix.stream);
      }
      const recorder = this.recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 });
      const recordingId = id;
      let pending = Promise.resolve();
      let queuedBytes = 0;
      let storageFailed = false;
      const started = performance.now();
      recorder.ondataavailable = event => {
        if (!event.data.size || storageFailed) return;
        queuedBytes += event.data.size;
        if (queuedBytes > 32 * 1024 * 1024) {
          storageFailed = true;
          this.error = "Saving could not keep up with recording. The partial video was kept.";
          this.stop(); return;
        }
        pending = pending.then(async () => {
          if (storageFailed) return;
          // Large encoder flushes are split into bounded IPC messages.
          for (let offset = 0; offset < event.data.size; offset += 4 * 1024 * 1024) {
            const bytes = await event.data.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer();
            await window.opendex.recordingChunk(recordingId, bytes);
          }
        }).catch(error => {
          storageFailed = true; this.error = String(error); this.stop();
        }).finally(() => { queuedBytes -= event.data.size; });
      };
      recorder.onerror = () => { this.error = "Video capture failed. The partial recording was kept."; this.stop(); };
      recorder.onstop = () => {
        void (async () => {
          await pending;
          const duration = performance.now() - started;
          this.release();
          try { await window.opendex.recordingFinish(recordingId, duration, this.error); }
          finally { this.busy = false; }
        })().catch(console.error);
      };
      for (const stream of this.streams) for (const track of stream.getTracks()) {
        track.addEventListener("ended", () => { this.error = "A capture source stopped. The partial recording was kept."; this.stop(); }, { once: true });
      }
      recorder.start(1000);
      await window.opendex.recordingStarted(recordingId);
      if (!this.cancelled) this.timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch (error) {
      if (this.recorder?.state === "recording") {
        this.error = String(error); this.stop();
      } else {
        this.release(); this.busy = false;
        if (id) await window.opendex.recordingFinish(id, 0, this.cancelled ? undefined : String(error));
      }
      if (!this.cancelled) throw error;
    }
  }
  stop() {
    this.cancelled = true;
    this.startup?.abort();
    clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }
  private release() {
    clearTimeout(this.timer);
    this.recorder = null;
    for (const stream of this.streams) stream.getTracks().forEach(track => track.stop());
    this.streams = [];
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.startup = null;
  }
}

export const interactionRecorder = new InteractionRecorder();
