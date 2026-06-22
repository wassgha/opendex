// Shared config types + defaults. Imported by the main process (store) and,
// for types only, by the preload/renderer through the IPC layer.

export type TtsEngine = "elevenlabs" | "system";
export type GreetingMode = "example" | "custom" | "none";
/** How the assistant addresses the user. Drives honorifics ("sir"/"ma'am") and
 *  is "unspecified" by default so we never presume a gender. */
export type UserGender = "male" | "female" | "unspecified";
export type WakeMode = "webspeech" | "manual" | "porcupine" | "vosk";
export type SttProvider = "webspeech" | "openai" | "whisper-local" | "vosk-local";
export type SecretName =
  | "AI_GATEWAY_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "TAVILY_API_KEY"
  | "PICOVOICE_ACCESS_KEY"
  | "OPENAI_API_KEY";

export interface OpenDexConfig {
  version: 1;
  assistant: {
    /** Spoken persona name, used in the system prompt. */
    name: string;
    /** Word that triggers active listening. */
    wakeWord: string;
    /** How the assistant addresses the user (honorifics). */
    userGender: UserGender;
    /** Custom persona/system prompt. Empty = built-in persona. The fixed
     *  spoken-output rules are always appended regardless. */
    persona: string;
  };
  llm: {
    /** AI Gateway model id, e.g. "anthropic/claude-sonnet-4-6". */
    model: string;
  };
  tts: {
    engine: TtsEngine;
    elevenLabs: { voiceId: string; modelId: string };
    system: { voiceURI: string | null; rate: number; pitch: number };
  };
  greeting: {
    /** example = bundled demo briefing · custom = user prompt · none = no proactive greeting */
    mode: GreetingMode;
    customPrompt: string;
  };
  voiceInput: {
    /** How active listening is triggered. */
    wakeMode: WakeMode;
    /** Built-in Porcupine keyword id (e.g. "jarvis", "computer", "bumblebee"). */
    porcupineKeyword: string;
    /** Which engine transcribes the captured command. */
    sttProvider: SttProvider;
    /** transformers.js Whisper model id (local STT). */
    whisperModel: string;
  };
  appearance: {
    /** Voice-visualization theme id (used from the themes phase onward). */
    theme: string;
    /** Show transient banners for each tool the agent calls. */
    showToolActivity: boolean;
  };
  skills: {
    /** Per-skill enablement; a skill is on unless explicitly false. */
    enabled: Record<string, boolean>;
    /** Standing permission decision per skill: ask each time / always / never. */
    permissions: Record<string, SkillPermission>;
  };
  analytics: {
    /** Send anonymous usage events (no voice, prompts, keys, URLs, or paths). */
    enabled: boolean;
  };
  onboarding: { completed: boolean };
}

export type SkillPermission = "ask" | "always" | "never";

export interface SecretsPresence {
  AI_GATEWAY_API_KEY: boolean;
  ELEVENLABS_API_KEY: boolean;
  TAVILY_API_KEY: boolean;
  PICOVOICE_ACCESS_KEY: boolean;
  OPENAI_API_KEY: boolean;
}

/** What the renderer receives — config plus which secrets are set (never the values). */
export interface PublicConfig {
  config: OpenDexConfig;
  secrets: SecretsPresence;
  /** Whether OS-level secret encryption is available (false → secrets stored obfuscated only). */
  encryptionAvailable: boolean;
}

export const DEFAULT_CONFIG: OpenDexConfig = {
  version: 1,
  assistant: { name: "Dex", wakeWord: "dex", userGender: "unspecified", persona: "" },
  llm: { model: "anthropic/claude-sonnet-4-6" },
  tts: {
    engine: "elevenlabs",
    elevenLabs: { voiceId: "JBFqnCBsd6RMkjVDRZzb", modelId: "eleven_turbo_v2_5" },
    system: { voiceURI: null, rate: 1, pitch: 1 },
  },
  greeting: { mode: "none", customPrompt: "" },
  voiceInput: {
    // Free, offline defaults: Vosk wake word + local Whisper transcription.
    wakeMode: "vosk",
    porcupineKeyword: "dex",
    sttProvider: "whisper-local",
    whisperModel: "Xenova/whisper-base.en",
  },
  appearance: { theme: "editorial", showToolActivity: true },
  skills: {
    // `computer` is opt-in (off until the user enables it in Settings).
    enabled: { open: true, computer: false },
    permissions: { open: "ask", computer: "ask" },
  },
  // Anonymous usage analytics, on by default (opt-out in onboarding/Settings).
  analytics: { enabled: true },
  onboarding: { completed: false },
};

export const SECRET_NAMES: SecretName[] = [
  "AI_GATEWAY_API_KEY",
  "ELEVENLABS_API_KEY",
  "TAVILY_API_KEY",
  "PICOVOICE_ACCESS_KEY",
  "OPENAI_API_KEY",
];

/** Deep-merge a partial patch into a config (one level of nesting is enough here). */
export function mergeConfig(
  base: OpenDexConfig,
  patch: DeepPartial<OpenDexConfig>,
): OpenDexConfig {
  const out: OpenDexConfig = structuredClone(base);
  for (const key of Object.keys(patch) as (keyof OpenDexConfig)[]) {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // @ts-expect-error - shallow section merge
      out[key] = { ...out[key], ...value };
    } else if (value !== undefined) {
      // @ts-expect-error - scalar assignment
      out[key] = value;
    }
  }
  return out;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? Partial<T[P]> : T[P];
};
