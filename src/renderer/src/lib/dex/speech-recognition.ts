// The main SpeechRecognition interface isn't yet in lib.dom.d.ts (only the
// SpeechRecognitionResult* helpers are). We declare just enough surface here
// to use it safely in Chrome/Safari/Edge.

export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message: string;
}

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
  onspeechend: ((event: Event) => void) | null;
  onaudioend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function createRecognition(opts: {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
}): SpeechRecognitionInstance | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = opts.continuous ?? false;
  rec.interimResults = opts.interimResults ?? false;
  rec.lang = opts.lang ?? "en-US";
  rec.maxAlternatives = 1;
  return rec;
}

export function joinTranscript(results: SpeechRecognitionResultList, fromIndex = 0): {
  finalText: string;
  interimText: string;
} {
  let finalText = "";
  let interimText = "";
  for (let i = fromIndex; i < results.length; i++) {
    const result = results[i];
    const alt = result[0];
    if (!alt) continue;
    if (result.isFinal) finalText += alt.transcript;
    else interimText += alt.transcript;
  }
  return { finalText: finalText.trim(), interimText: interimText.trim() };
}
