import { useEffect, useState } from "react";

export interface SystemVoiceInfo {
  voiceURI: string;
  label: string;
}

/**
 * macOS ships a set of "novelty" speech-synthesis voices (musical/robotic gimmicks
 * like Bells, Boing, Trinoids) alongside the real human voices. They're identified
 * by name, so we filter them out of the picker.
 */
const NOVELTY_VOICE_NAMES = new Set(
  [
    "Albert",
    "Bad News",
    "Bahh",
    "Bells",
    "Boing",
    "Bubbles",
    "Cellos",
    "Deranged",
    "Good News",
    "Hysterical",
    "Jester",
    "Junior",
    "Organ",
    "Pipe Organ",
    "Princess",
    "Ralph",
    "Superstar",
    "Trinoids",
    "Whisper",
    "Wobble",
    "Zarvox",
  ].map((n) => n.toLowerCase()),
);

function isHumanVoice(v: SpeechSynthesisVoice): boolean {
  return !NOVELTY_VOICE_NAMES.has(v.name.trim().toLowerCase());
}

/** Enumerates the OS speech-synthesis voices (async; fires `voiceschanged`). */
export function useSystemVoices(): SystemVoiceInfo[] {
  const [voices, setVoices] = useState<SystemVoiceInfo[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const read = () => {
      const list = window.speechSynthesis
        .getVoices()
        .filter(isHumanVoice)
        .map((v) => ({
          voiceURI: v.voiceURI,
          label: `${v.name} (${v.lang})${v.default ? " — default" : ""}`,
        }));
      setVoices(list);
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, []);

  return voices;
}
