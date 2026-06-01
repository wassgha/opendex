import { useEffect, useState } from "react";

export interface SystemVoiceInfo {
  voiceURI: string;
  label: string;
}

/** Enumerates the OS speech-synthesis voices (async; fires `voiceschanged`). */
export function useSystemVoices(): SystemVoiceInfo[] {
  const [voices, setVoices] = useState<SystemVoiceInfo[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const read = () => {
      const list = window.speechSynthesis.getVoices().map((v) => ({
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
