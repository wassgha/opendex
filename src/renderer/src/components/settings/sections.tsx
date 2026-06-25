import { useState, type ComponentType } from "react";
import {
  User,
  Mic,
  Palette,
  Blocks,
  Cpu,
  AudioLines,
  MessageSquare,
  ShieldCheck,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import type { PublicConfig } from "../../../../main/config/schema";
import type {
  DeepPartial,
  OpenDexConfig,
  SecretName,
} from "../../../../main/config/schema";
import {
  SecretField,
  SegmentedControl,
  SelectField,
  TextArea,
  TextField,
} from "../ui/fields";
import { useSystemVoices } from "@/lib/use-system-voices";
import { ThemePicker } from "@/components/themes/theme-picker";
import { SKILLS_META } from "@/lib/skills-meta";
import {
  ProviderPicker,
  defaultModelFor,
  useAppleAvailability,
} from "@/components/llm/provider-picker";

export interface SectionProps {
  data: PublicConfig;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
  resetConfig: () => Promise<void>;
}

// A labelled control with an inline toggle/segmented control on the right.
function ToggleRow({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium text-foreground/90">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}

function AssistantSection({ data, setConfig }: SectionProps) {
  const { config } = data;
  return (
    <>
      <TextField
        label="Name"
        hint="How the assistant refers to itself."
        value={config.assistant.name}
        onChange={(v) => setConfig({ assistant: { name: v } })}
      />
      <SelectField
        label="How it should address you"
        hint="Controls honorifics. Choose neutral to avoid “sir” / “ma’am” entirely."
        value={config.assistant.userGender}
        options={[
          { value: "unspecified", label: "Neutral — no honorific" },
          { value: "male", label: "“Sir”" },
          { value: "female", label: "“Ma’am”" },
        ]}
        onChange={(v) => setConfig({ assistant: { userGender: v } })}
      />
      <TextField
        label="Wake word"
        hint="Used by the Web Speech wake mode."
        value={config.assistant.wakeWord}
        onChange={(v) => setConfig({ assistant: { wakeWord: v } })}
      />
      <TextArea
        label="Personality (custom system prompt)"
        hint="Replaces the built-in persona. The spoken-output rules (short replies, no markdown, etc.) and your address preference are always kept. Leave blank for the default."
        value={config.assistant.persona}
        placeholder="e.g. You are Dex, a warm, concise, no-nonsense assistant who keeps things casual and gets to the point."
        onChange={(v) => setConfig({ assistant: { persona: v } })}
      />
    </>
  );
}

function VoiceInputSection({ data, setConfig, setSecret }: SectionProps) {
  const { config, secrets } = data;
  return (
    <>
      <SelectField
        label="How to start listening"
        hint="Push-to-talk and Vosk work without any paid key."
        value={config.voiceInput.wakeMode}
        options={[
          { value: "manual", label: "Push to talk (click / ⌘⇧Space)" },
          { value: "vosk", label: "Wake word (Vosk — free, offline)" },
          { value: "webspeech", label: "Wake word (Web Speech — browser)" },
        ]}
        onChange={(v) => setConfig({ voiceInput: { ...config.voiceInput, wakeMode: v } })}
      />
      <SelectField
        label="Transcription (speech-to-text)"
        hint="Whisper-local and Vosk-local are free and offline (one-time model download)."
        value={config.voiceInput.sttProvider}
        options={[
          { value: "whisper-local", label: "Local Whisper (free, offline)" },
          { value: "vosk-local", label: "Local Vosk (free, offline, fast)" },
          { value: "openai", label: "OpenAI Whisper (cloud)" },
          { value: "webspeech", label: "Web Speech (browser)" },
        ]}
        onChange={(v) => setConfig({ voiceInput: { ...config.voiceInput, sttProvider: v } })}
      />
      {config.voiceInput.sttProvider === "openai" && (
        <SecretField
          label="OpenAI API key"
          hint="Used in the main process to transcribe captured audio."
          present={secrets.OPENAI_API_KEY}
          onSave={(v) => setSecret("OPENAI_API_KEY", v)}
        />
      )}
      {config.voiceInput.sttProvider === "whisper-local" && (
        <SelectField
          label="Whisper model"
          hint="Bigger = more accurate but larger download + slower on CPU."
          value={config.voiceInput.whisperModel}
          options={[
            { value: "Xenova/whisper-tiny.en", label: "tiny.en (~75MB)" },
            { value: "Xenova/whisper-base.en", label: "base.en (~145MB)" },
            { value: "Xenova/whisper-small.en", label: "small.en (~480MB)" },
          ]}
          onChange={(v) =>
            setConfig({ voiceInput: { ...config.voiceInput, whisperModel: v } })
          }
        />
      )}
    </>
  );
}

function AppearanceSection({ data, setConfig }: SectionProps) {
  const { config } = data;
  return (
    <>
      <ThemePicker
        value={config.appearance.theme}
        onChange={(id) => setConfig({ appearance: { theme: id } })}
      />
      <ToggleRow
        title="Tool activity banners"
        description="Show what the assistant is doing (each tool it calls) as it works."
      >
        <SegmentedControl
          value={config.appearance.showToolActivity ? "on" : "off"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => setConfig({ appearance: { showToolActivity: v === "on" } })}
        />
      </ToggleRow>
    </>
  );
}

function SkillsSection({ data, setConfig }: SectionProps) {
  const { config } = data;
  return (
    <>
      {SKILLS_META.map((skill) => {
        const enabled = skill.optIn
          ? config.skills.enabled[skill.id] === true
          : config.skills.enabled[skill.id] !== false;
        const permission = config.skills.permissions[skill.id] ?? "ask";
        return (
          <div key={skill.id} className="flex flex-col gap-2">
            <ToggleRow title={skill.label} description={skill.description}>
              <SegmentedControl
                value={enabled ? "on" : "off"}
                options={[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(v) =>
                  setConfig({
                    skills: {
                      ...config.skills,
                      enabled: { ...config.skills.enabled, [skill.id]: v === "on" },
                    },
                  })
                }
              />
            </ToggleRow>
            {enabled && skill.sensitive && (
              <SelectField
                label="Permission"
                value={permission}
                options={[
                  { value: "ask", label: "Ask each time" },
                  { value: "always", label: "Always allow" },
                  { value: "never", label: "Never allow" },
                ]}
                onChange={(v) =>
                  setConfig({
                    skills: {
                      ...config.skills,
                      permissions: { ...config.skills.permissions, [skill.id]: v },
                    },
                  })
                }
              />
            )}
            {enabled && skill.id === "computer" && (
              <ToggleRow
                title="Animate cursor"
                description="Move the pointer smoothly so you can follow along. Turn off for the fastest actions (instant jumps)."
              >
                <SegmentedControl
                  value={config.computer.animateCursor ? "on" : "off"}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  onChange={(v) =>
                    setConfig({ computer: { animateCursor: v === "on" } })
                  }
                />
              </ToggleRow>
            )}
          </div>
        );
      })}
    </>
  );
}

function ModelSection({ data, setConfig, setSecret }: SectionProps) {
  const { config, secrets } = data;
  const apple = useAppleAvailability();
  return (
    <>
      <ProviderPicker
        data={data}
        selected={config.llm.provider}
        onSelect={(id) =>
          // Keep the current model only if switching back to the same provider;
          // otherwise reset to that provider's default id.
          setConfig({
            llm: id === config.llm.provider ? { provider: id } : { provider: id, model: defaultModelFor(id) },
          })
        }
        setConfig={setConfig}
        setSecret={setSecret}
        apple={apple}
      />
      <SecretField
        label="Tavily API key (web search)"
        hint="Optional — enables the web-search tool."
        present={secrets.TAVILY_API_KEY}
        onSave={(v) => setSecret("TAVILY_API_KEY", v)}
      />
    </>
  );
}

function TtsSection({ data, setConfig, setSecret }: SectionProps) {
  const { config, secrets } = data;
  const voices = useSystemVoices();
  return (
    <>
      <SegmentedControl
        value={config.tts.engine}
        options={[
          { value: "elevenlabs", label: "ElevenLabs" },
          { value: "system", label: "System voice" },
        ]}
        onChange={(v) => setConfig({ tts: { engine: v } })}
      />
      {config.tts.engine === "elevenlabs" ? (
        <>
          <SecretField
            label="ElevenLabs API key"
            present={secrets.ELEVENLABS_API_KEY}
            onSave={(v) => setSecret("ELEVENLABS_API_KEY", v)}
          />
          <TextField
            label="Voice ID"
            hint="From your ElevenLabs voice library."
            value={config.tts.elevenLabs.voiceId}
            onChange={(v) =>
              setConfig({ tts: { elevenLabs: { ...config.tts.elevenLabs, voiceId: v } } })
            }
          />
          <TextField
            label="Model"
            value={config.tts.elevenLabs.modelId}
            onChange={(v) =>
              setConfig({ tts: { elevenLabs: { ...config.tts.elevenLabs, modelId: v } } })
            }
          />
        </>
      ) : (
        <SelectField
          label="System voice"
          hint={voices.length ? undefined : "Loading available voices…"}
          value={config.tts.system.voiceURI ?? ""}
          options={[
            { value: "", label: "Default" },
            ...voices.map((v) => ({ value: v.voiceURI, label: v.label })),
          ]}
          onChange={(v) =>
            setConfig({ tts: { system: { ...config.tts.system, voiceURI: v || null } } })
          }
        />
      )}
    </>
  );
}

function GreetingSection({ data, setConfig }: SectionProps) {
  const { config } = data;
  return (
    <>
      <SelectField
        label="Proactive greeting"
        hint="What the assistant says the first time you wake it."
        value={config.greeting.mode}
        options={[
          { value: "example", label: "Example briefing (demo)" },
          { value: "custom", label: "Custom prompt" },
          { value: "none", label: "None — just listen" },
        ]}
        onChange={(v) => setConfig({ greeting: { ...config.greeting, mode: v } })}
      />
      {config.greeting.mode === "custom" && (
        <TextArea
          label="Custom greeting prompt"
          hint="Instructions for the spoken greeting. Include any data you want it to reference."
          value={config.greeting.customPrompt}
          placeholder="e.g. Greet me, summarise my calendar for today, and suggest what to focus on…"
          onChange={(v) => setConfig({ greeting: { ...config.greeting, customPrompt: v } })}
        />
      )}
    </>
  );
}

function PrivacySection({ data, setConfig }: SectionProps) {
  const { config } = data;
  return (
    <>
      <ToggleRow
        title="Anonymous usage data"
        description={
          <>
            Helps improve OpenDex. Never sends voice, transcripts, prompts, API
            keys, opened URLs, or file paths.{" "}
            <a
              href="https://github.com/wassgha/opendex/blob/main/PRIVACY.md"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Learn more
            </a>
          </>
        }
      >
        <SegmentedControl
          value={config.analytics.enabled ? "on" : "off"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => setConfig({ analytics: { enabled: v === "on" } })}
        />
      </ToggleRow>
      <div className="text-xs text-muted-foreground">
        {data.encryptionAvailable
          ? "API keys are encrypted with your OS keychain."
          : "Warning: OS keychain unavailable — API keys are stored obfuscated, not encrypted."}
      </div>
    </>
  );
}

function ResetSection({ data, resetConfig }: SectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const onReset = async () => {
    setBusy(true);
    try {
      await resetConfig();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="text-sm text-muted-foreground">
        Restore every setting to its defaults and re-run first-time onboarding.
        This clears your assistant name, theme, voice, model, and skill choices
        {data.encryptionAvailable
          ? ", and removes any API keys saved in the app"
          : ""}
        . This can’t be undone.
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={onReset} disabled={busy}>
            {busy ? "Resetting…" : "Yes, reset everything"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Reset to defaults
          </Button>
        </div>
      )}
    </>
  );
}

export interface SettingsSection {
  id: string;
  label: string;
  Icon: LucideIcon;
  Component: ComponentType<SectionProps>;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "assistant", label: "Assistant", Icon: User, Component: AssistantSection },
  { id: "voice-input", label: "Voice input", Icon: Mic, Component: VoiceInputSection },
  { id: "appearance", label: "Appearance", Icon: Palette, Component: AppearanceSection },
  { id: "skills", label: "Skills & tools", Icon: Blocks, Component: SkillsSection },
  { id: "model", label: "Language model", Icon: Cpu, Component: ModelSection },
  { id: "tts", label: "Voice (TTS)", Icon: AudioLines, Component: TtsSection },
  { id: "greeting", label: "Greeting", Icon: MessageSquare, Component: GreetingSection },
  { id: "privacy", label: "Privacy", Icon: ShieldCheck, Component: PrivacySection },
  { id: "reset", label: "Reset", Icon: RotateCcw, Component: ResetSection },
];
