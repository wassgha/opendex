// Encode 16 kHz mono Int16 PCM frames (as emitted by WebVoiceProcessor) into a
// WAV ArrayBuffer suitable for upload to a cloud STT provider.

export function encodeWav(frames: Int16Array[], sampleRate = 16000): ArrayBuffer {
  let length = 0;
  for (const f of frames) length += f.length;

  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      view.setInt16(offset, f[i], true);
      offset += 2;
    }
  }
  return buffer;
}

/** RMS loudness (0..1) of an Int16 PCM frame. */
export function frameRms(frame: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}
