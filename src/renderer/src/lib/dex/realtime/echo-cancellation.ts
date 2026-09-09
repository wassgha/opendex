/** Ask the browser to cancel local playback as well as remote call audio.
 * Boolean true leaves that choice to the browser. Never mute the microphone:
 * near-end speech must remain available for spoken interruption. */
export async function configureEchoCancellation(track: MediaStreamTrack) {
  const capabilities = track.getCapabilities?.() as { echoCancellation?: Array<boolean | string> } | undefined;
  const modes = capabilities?.echoCancellation ?? [];
  let requested: boolean | string = true;
  let fallback: string | undefined;
  if (modes.includes('all')) {
    try {
      // Some TypeScript DOM versions predate standardized string modes.
      await track.applyConstraints({ echoCancellation: { exact: 'all' } } as unknown as MediaTrackConstraints);
      requested = 'all';
    } catch (error) {
      fallback = error instanceof Error ? error.name : 'constraint-rejected';
      await track.applyConstraints({ echoCancellation: true });
    }
  } else {
    await track.applyConstraints({ echoCancellation: true });
  }
  const settings = track.getSettings();
  return {
    requested, actual: settings.echoCancellation,
    supportedModes: modes, noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl, sampleRate: settings.sampleRate,
    fallback,
  };
}
