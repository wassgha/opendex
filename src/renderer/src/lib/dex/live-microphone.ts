/** Reuse only live audio; release a late permission result after pause/teardown. */
export async function acquireLiveMicrophone(
  current: MediaStream | null,
  acquire: () => Promise<MediaStream>,
  isCurrent: () => boolean,
): Promise<MediaStream | null> {
  if (!isCurrent()) return null;
  if (current?.getAudioTracks().some((track) => track.readyState === "live")) return current;
  current?.getTracks().forEach((track) => track.stop());
  const stream = await acquire();
  if (!isCurrent()) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  return stream;
}
