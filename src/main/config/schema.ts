// Shared config types + defaults. Imported by the main process (store) and,
// for types only, by the preload/renderer through the IPC layer.

export type TtsEngine = "elevenlabs" | "system";
export type GreetingMode = "example" | "custom" | "none";
/** How the assistant addresses the user. Drives honorifics ("sir"/"ma'am") and
 *  is "unspecified" by default so we never presume a gender. */
export type UserGender = "male" | "female" | "unspecified";
export type WakeMode = "webspeech" | "manual" | "vosk";
/** Window layout: the full themed experience, or a slim top-pinned bar. */
export type WindowMode = "full" | "notch";
export type SttProvider = "webspeech" | "openai" | "whisper-local" | "vosk-local";
/** How the voice session runs: `pipeline` = wake → STT → LLM → TTS (separate
 *  engines, free/local options); `realtime` = one speech-to-speech model over a
 *  WebSocket (most natural voice, needs a gateway key). */
export type VoiceMode = "pipeline" | "realtime";
/** Which backend hosts the realtime session. `gateway` is the Vercel AI Gateway
 *  (one key, OpenAI + xAI realtime models); `openai` is reserved for a direct
 *  BYOK connection (not implemented yet). */
export type RealtimeProvider = "gateway" | "openai";
/** Which provider routes chat completions. `apple` is free + on-device (macOS);
 *  `openai`/`anthropic`/`xai` are bring-your-own-key; `gateway` is the Vercel AI
 *  Gateway (one key, any provider); `opendex` is our hosted subscription
 *  (reserved — not implemented yet). */
export type LlmProvider = "apple" | "openai" | "anthropic" | "xai" | "gateway" | "opendex";
/** How a provider authenticates: `none` (local), `key` (user-pasted secret), or
 *  `account` (a session we manage — reserved for the OpenDex subscription). */
export type ProviderAuth = "none" | "key" | "account";
export type SecretName =
  | "AI_GATEWAY_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "TAVILY_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "XAI_API_KEY";

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
    /** Which provider routes chat completions. */
    provider: LlmProvider;
    /** Model id, interpreted per-provider: slash form for the gateway
     *  ("anthropic/claude-sonnet-4-6"), bare id for direct providers
     *  ("gpt-5"), ignored for apple (single on-device model). */
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
  voice: {
    /** pipeline = today's wake→STT→LLM→TTS flow · realtime = speech-to-speech session */
    mode: VoiceMode;
  };
  realtime: {
    /** Which backend hosts the realtime session (v1 ships gateway only). */
    provider: RealtimeProvider;
    /** Gateway slash-form model id, e.g. "openai/gpt-realtime-2". */
    model: string;
    /** Provider voice id the model speaks with, e.g. "marin". */
    voice: string;
    /** Seconds of user inactivity before the session disconnects back to
     *  passive wake. Must stay under the gateway's 300s idle kill. */
    idleDisconnectSec: number;
  };
  voiceInput: {
    /** How active listening is triggered. In realtime mode this still gates
     *  when a session connects; `sttProvider` is unused there (the realtime
     *  model transcribes). */
    wakeMode: WakeMode;
    /** Which engine transcribes the captured command (pipeline mode). */
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
  hotkeys: {
    /** Global accelerator that summons / hides the main window (Spotlight-style). */
    summon: string;
  };
  skills: {
    /** Per-skill enablement; a skill is on unless explicitly false. */
    enabled: Record<string, boolean>;
    /** Standing permission decision per skill: ask each time / always / never. */
    permissions: Record<string, SkillPermission>;
  };
  computer: {
    /** Animate cursor moves (watchable) vs teleport instantly (fastest). */
    animateCursor: boolean;
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
  OPENAI_API_KEY: boolean;
  ANTHROPIC_API_KEY: boolean;
  XAI_API_KEY: boolean;
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
  // Defaults to the gateway so configs written before the provider field
  // (which only had `llm.model`) keep working after upgrade. First-run
  // onboarding forces an explicit choice regardless.
  llm: { provider: "gateway", model: "anthropic/claude-sonnet-4-6" },
  tts: {
    engine: "elevenlabs",
    elevenLabs: { voiceId: "JBFqnCBsd6RMkjVDRZzb", modelId: "eleven_turbo_v2_5" },
    system: { voiceURI: null, rate: 1, pitch: 1 },
  },
  greeting: { mode: "none", customPrompt: "" },
  // Pipeline by default — realtime is an explicit choice (it needs a gateway
  // key and bills per session). mergeConfig back-fills these sections into
  // configs written before they existed.
  voice: { mode: "pipeline" },
  realtime: {
    provider: "gateway",
    model: "openai/gpt-realtime-2",
    voice: "marin",
    // Short follow-up window: sessions bill by the minute, so hang up quickly
    // once nobody is talking (the timer never counts mid-speech or during
    // playback — see realtime-session.ts resetIdle).
    idleDisconnectSec: 10,
  },
  voiceInput: {
    // Free, offline defaults: Vosk wake word + local Whisper transcription.
    wakeMode: "vosk",
    sttProvider: "whisper-local",
    whisperModel: "Xenova/whisper-base.en",
  },
  appearance: { theme: "editorial", showToolActivity: true },
  // `Alt+Space` reads as ⌥Space on macOS (low-conflict). On Windows Alt+Space
  // opens the system window menu and won't register; the registrar falls back to
  // a secondary accelerator in that case (see registerSummonHotkey in index.ts).
  hotkeys: { summon: "Alt+Space" },
  skills: {
    // `computer` is opt-in (off until the user enables it in Settings).
    enabled: { open: true, computer: false },
    permissions: { open: "ask", computer: "ask" },
  },
  computer: { animateCursor: true },
  // Anonymous usage analytics, on by default (opt-out in onboarding/Settings).
  analytics: { enabled: true },
  onboarding: { completed: false },
};

export const SECRET_NAMES: SecretName[] = [
  "AI_GATEWAY_API_KEY",
  "ELEVENLABS_API_KEY",
  "TAVILY_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
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
