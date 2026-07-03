// Streams the session mic as 24kHz mono PCM16 frames for the realtime model.
// An AudioWorklet on the shared 24kHz AudioContext taps the existing mic stream
// (echo cancellation / noise suppression already applied by getUserMedia — the
// context resamples the hardware rate for us) and posts raw Float32 quanta;
// this class batches them into ~40ms Int16 frames. WVP isn't reusable here —
// it's pinned to 16kHz.

// Registered once per AudioContext (see ensureWorkletModule).
const WORKLET_CODE = `
class PcmFeedProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("opendex-pcm-feed", PcmFeedProcessor);
`;

// ~40ms at 24kHz — small enough for low latency, large enough to keep IPC
// message rate modest (~25/s).
const FRAME_SAMPLES = 960;

const moduleReady = new WeakMap<AudioContext, Promise<void>>();

function ensureWorkletModule(ctx: AudioContext): Promise<void> {
  let ready = moduleReady.get(ctx);
  if (!ready) {
    const url = URL.createObjectURL(
      new Blob([WORKLET_CODE], { type: "application/javascript" }),
    );
    ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    moduleReady.set(ctx, ready);
  }
  return ready;
}

export class MicPcmFeed {
  private constructor(
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly sink: GainNode,
  ) {}

  static async create(
    ctx: AudioContext,
    micStream: MediaStream,
    onFrame: (chunk: ArrayBuffer) => void,
  ): Promise<MicPcmFeed> {
    await ensureWorkletModule(ctx);
    const source = ctx.createMediaStreamSource(micStream);
    const node = new AudioWorkletNode(ctx, "opendex-pcm-feed", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // The graph must reach the destination for the worklet to be pulled;
    // a zero gain keeps the mic inaudible (no feedback).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    let pending = new Int16Array(FRAME_SAMPLES);
    let filled = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const floats = e.data;
      for (let i = 0; i < floats.length; i++) {
        const s = Math.max(-1, Math.min(1, floats[i]));
        pending[filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (filled === FRAME_SAMPLES) {
          onFrame(pending.buffer);
          pending = new Int16Array(FRAME_SAMPLES);
          filled = 0;
        }
      }
    };

    return new MicPcmFeed(source, node, sink);
  }

  stop(): void {
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
  }
}
