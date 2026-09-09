import type { MicVAD } from '@ricky0123/vad-web';
import { SpeechGate, pcm24k } from './speech-gate';

/** Forward the echo-cancelled microphone continuously to the realtime model.
 * Local speech classification accompanies each frame: double-talk can receive low
 * confidence and must not be replaced with silence before server VAD hears it.
 * Original wake audio uses its separate confirmed-wake replay path. */
export class MicPcmFeed {
  private stopped = false;
  private diagnosticsTimer?: ReturnType<typeof setInterval>;
  private constructor(private vad: MicVAD, private gate: SpeechGate) {}
  static async create(ctx: AudioContext, micStream: MediaStream, onFrame: (chunk: ArrayBuffer, speechProbability?: number) => void,
    onGate: (open: boolean) => void = () => {},
    onDiagnostics: (stats: Record<string, number | boolean | string>) => void = () => {},
    isPlayback: () => boolean = () => true,
    createVad?: (options: Parameters<typeof MicVAD.new>[0]) => Promise<MicVAD>,
    onPreviewFrame?: (frame: Float32Array) => void): Promise<MicPcmFeed> {
    const makeVad = createVad ?? ((await import('@ricky0123/vad-web')).MicVAD.new);
    const assets = new URL('./vad/', document.baseURI).href;
    let feed: MicPcmFeed | undefined;
    let frames = 0, peakSpeech = 0, peakRms = 0, highFrames = 0, streak = 0, maxStreak = 0, gateOpen = false;
    const gate = new SpeechGate(open => { gateOpen = open; onGate(open); });
    const vad = await makeVad({
      model: 'v5', startOnLoad: false, audioContext: ctx,
      baseAssetPath: assets, onnxWASMBasePath: assets,
      ortConfig: ort => { ort.env.wasm.numThreads = 1; },
      getStream: async () => micStream,
      pauseStream: async () => {}, resumeStream: async () => micStream,
      onFrameProcessed: (probabilities, frame) => {
        if (!feed || feed.stopped) return;
        frames++;
        peakSpeech = Math.max(peakSpeech, probabilities.isSpeech);
        let energy = 0;
        for (const sample of frame) energy += sample * sample;
        peakRms = Math.max(peakRms, Math.sqrt(energy / frame.length));
        if (probabilities.isSpeech >= 0.65) { highFrames++; streak++; } else streak = 0;
        maxStreak = Math.max(maxStreak, streak);
        // Do not forward the gate's zeroed frames or its buffered pre-roll.
        // Each captured frame must reach the server exactly once, in order.
        onFrame(pcm24k(frame), probabilities.isSpeech);
        gate.process(probabilities.isSpeech, frame, isPlayback());
        onPreviewFrame?.(frame);
      },
    });
    feed = new MicPcmFeed(vad, gate);
    try { await vad.start(); } catch (error) { feed.stop(); throw error; }
    // Aggregate only: no samples or recorded audio. A timer also reports zero
    // frames when capture stalls, unlike a callback-driven diagnostic.
    feed.diagnosticsTimer = setInterval(() => {
      const track = micStream.getAudioTracks()[0];
      onDiagnostics({ frames, peakSpeech: +peakSpeech.toFixed(3), peakRms: +peakRms.toFixed(4), highFrames, maxStreak, gateOpen,
        forwarding: "continuous", localClassificationOnly: false,
        onsetThreshold: isPlayback() ? 0.65 : 0.5, onsetFrames: isPlayback() ? 5 : 3,
        trackState: track?.readyState ?? 'missing', trackMuted: track?.muted ?? true, contextState: ctx.state });
      frames = 0; peakSpeech = 0; peakRms = 0; highFrames = 0; maxStreak = streak;
    }, 1000);
    return feed;
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.gate.clear();
    clearInterval(this.diagnosticsTimer);
    void this.vad.destroy().catch(() => {});
  }
}
