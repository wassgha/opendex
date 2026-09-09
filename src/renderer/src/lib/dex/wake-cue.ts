/** Brief local acknowledgment, fired at detection before network/model work. */
export function playWakeCue(): void {
  try {
    const context = new AudioContext();
    // Expire promptly if playback is blocked; never chime on a later gesture.
    const expiry = setTimeout(() => { void context.close().catch(() => {}); }, 350);
    const play = () => {
      if (context.state !== "running") return;
      clearTimeout(expiry);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); void context.close().catch(() => {}); };
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    };
    if (context.state === "running") play();
    else void context.resume().then(play).catch(() => {});
  } catch {
    // Visual acknowledgment remains available if audio is unavailable.
  }
}
