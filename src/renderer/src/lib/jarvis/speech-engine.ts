import { TtsPlayer } from "./tts-player";

// Common interface for spoken output, so the orchestrator (use-jarvis) is
// agnostic to whether audio comes from ElevenLabs (main process) or the OS's
// built-in speech synthesis (renderer Web Speech).
export interface SpeechEngine {
  enqueue(text: string): void;
  stop(): void;
  unlock(): void;
  readonly isSpeaking: boolean;
}

export interface SpeechEngineCallbacks {
  onStateChange: (speaking: boolean) => void;
  onAudioBlocked: () => void;
}

export interface SystemVoiceOptions {
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

export type SpeechEngineKind = "elevenlabs" | "system";

/**
 * System TTS via the renderer's SpeechSynthesis API. Sentences are spoken in
 * order; speaking-state is tracked so the orchestrator's state machine behaves
 * the same as with ElevenLabs. No audio-unlock gesture is needed.
 */
export class SystemSpeechEngine implements SpeechEngine {
  private pending = 0;
  private speaking = false;
  private stopped = false;

  constructor(
    private readonly cb: SpeechEngineCallbacks,
    private readonly opts: SystemVoiceOptions,
  ) {}

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    if (this.opts.voiceURI) {
      const match = voices.find((v) => v.voiceURI === this.opts.voiceURI);
      if (match) return match;
    }
    // Prefer an English voice if no explicit choice.
    return voices.find((v) => v.lang?.startsWith("en")) ?? voices[0] ?? null;
  }

  enqueue(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.stopped = false;

    const utterance = new SpeechSynthesisUtterance(trimmed);
    const voice = this.pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = this.opts.rate;
    utterance.pitch = this.opts.pitch;

    this.pending += 1;
    if (!this.speaking) {
      this.speaking = true;
      this.cb.onStateChange(true);
    }

    const settle = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0 && !this.stopped) {
        this.speaking = false;
        this.cb.onStateChange(false);
      }
    };
    utterance.onend = settle;
    utterance.onerror = settle;

    window.speechSynthesis.speak(utterance);
  }

  stop() {
    this.stopped = true;
    this.pending = 0;
    window.speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.cb.onStateChange(false);
    }
  }

  // No-op: SpeechSynthesis doesn't require an audio-unlock gesture.
  unlock() {}

  get isSpeaking() {
    return this.speaking || this.pending > 0;
  }
}

export interface CreateSpeechEngineOptions {
  kind: SpeechEngineKind;
  callbacks: SpeechEngineCallbacks;
  system: SystemVoiceOptions;
}

export function createSpeechEngine(opts: CreateSpeechEngineOptions): SpeechEngine {
  if (opts.kind === "system") {
    return new SystemSpeechEngine(opts.callbacks, opts.system);
  }
  return new TtsPlayer(opts.callbacks);
}
