/** Local WebRTC loopback makes synthesized speech a remote-track playout
 * reference for the browser's acoustic echo canceller. No STUN/TURN servers,
 * network signaling service, or microphone tracks are involved. */
export class EchoReferenceOutput {
  private constructor(
    readonly input: MediaStreamAudioDestinationNode,
    private sender: RTCPeerConnection,
    private receiver: RTCPeerConnection,
    private audio: HTMLAudioElement,
  ) {}

  static async create(ctx: AudioContext, onBlocked: () => void): Promise<EchoReferenceOutput> {
    const input = ctx.createMediaStreamDestination();
    const sender = new RTCPeerConnection({ iceServers: [] });
    const receiver = new RTCPeerConnection({ iceServers: [] });
    const audio = new Audio();
    audio.autoplay = true;
    const output = new EchoReferenceOutput(input, sender, receiver, audio);
    const toSender: RTCIceCandidate[] = [];
    const toReceiver: RTCIceCandidate[] = [];
    let rejectConnection: (error: Error) => void = () => {};
    const relay = (target: RTCPeerConnection, queue: RTCIceCandidate[]) => (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) return;
      if (!target.remoteDescription) queue.push(e.candidate);
      else void target.addIceCandidate(e.candidate).catch(() => rejectConnection(new Error('Local audio reference ICE failed')));
    };
    sender.onicecandidate = relay(receiver, toReceiver);
    receiver.onicecandidate = relay(sender, toSender);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = new Promise<void>((resolve, reject) => {
      rejectConnection = reject;
      timer = setTimeout(() => reject(new Error('Local audio reference connection timed out')), 8000);
      receiver.onconnectionstatechange = () => {
        if (receiver.connectionState === 'connected') resolve();
        if (receiver.connectionState === 'failed') reject(new Error('Local audio reference connection failed'));
      };
    });
    // Attach a rejection handler immediately while SDP is being negotiated.
    void connected.catch(() => {});
    receiver.ontrack = e => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(onBlocked);
    };
    try {
      for (const track of input.stream.getTracks()) sender.addTrack(track, input.stream);
      await sender.setLocalDescription(await sender.createOffer());
      await receiver.setRemoteDescription(sender.localDescription!);
      for (const candidate of toReceiver.splice(0)) await receiver.addIceCandidate(candidate);
      await receiver.setLocalDescription(await receiver.createAnswer());
      await sender.setRemoteDescription(receiver.localDescription!);
      for (const candidate of toSender.splice(0)) await sender.addIceCandidate(candidate);
      await connected;
      return output;
    } catch (error) {
      output.dispose();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  unlock() { void this.audio.play().catch(() => {}); }
  pause() { this.audio.pause(); }
  dispose() {
    this.sender.onicecandidate = null;
    this.receiver.onicecandidate = null;
    this.receiver.onconnectionstatechange = null;
    this.receiver.ontrack = null;
    this.sender.close(); this.receiver.close();
    this.audio.pause(); this.audio.srcObject = null;
    this.input.stream.getTracks().forEach(track => track.stop());
    this.input.disconnect();
  }
}
