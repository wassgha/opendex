import type { PublicConfig } from "../../../../main/config/schema";
import type { DeepPartial, OpenDexConfig, SecretName } from "../../../../main/config/schema";
import {
  SecretField,
  SegmentedControl,
  SelectField,
  TextArea,
  TextField,
} from "../ui/fields";
import { useSystemVoices } from "@/lib/use-system-voices";
import { ThemePicker } from "@/components/themes/theme-picker";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-b border-white/5 py-6">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SettingsPanel({
  data,
  setConfig,
  setSecret,
  onClose,
}: {
  data: PublicConfig;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
  onClose: () => void;
}) {
  const { config, secrets } = data;
  const voices = useSystemVoices();

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0e0e0e] px-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-[#0e0e0e]/95 py-5 backdrop-blur">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 hover:bg-white/10"
          >
            Done
          </button>
        </div>

        <Section title="Assistant">
          <TextField
            label="Name"
            hint="How the assistant refers to itself."
            value={config.assistant.name}
            onChange={(v) => setConfig({ assistant: { name: v } })}
          />
          <TextField
            label="Wake word"
            hint="Used by the Web Speech wake mode."
            value={config.assistant.wakeWord}
            onChange={(v) => setConfig({ assistant: { wakeWord: v } })}
          />
        </Section>

        <Section title="Voice input">
          <SelectField
            label="How to start listening"
            hint="Push-to-talk and Vosk work without any paid key."
            value={config.voiceInput.wakeMode}
            options={[
              { value: "manual", label: "Push to talk (click / ⌘⇧Space)" },
              { value: "vosk", label: "Wake word (Vosk — free, offline)" },
              { value: "porcupine", label: "Wake word (Porcupine, hands-free)" },
              { value: "webspeech", label: "Wake word (Web Speech — browser)" },
            ]}
            onChange={(v) => setConfig({ voiceInput: { ...config.voiceInput, wakeMode: v } })}
          />
          {config.voiceInput.wakeMode === "porcupine" && (
            <>
              <SelectField
                label="Wake keyword"
                value={config.voiceInput.porcupineKeyword}
                options={[
                  { value: "jarvis", label: "Jarvis" },
                  { value: "computer", label: "Computer" },
                  { value: "bumblebee", label: "Bumblebee" },
                  { value: "porcupine", label: "Porcupine" },
                  { value: "picovoice", label: "Picovoice" },
                  { value: "alexa", label: "Alexa" },
                  { value: "terminator", label: "Terminator" },
                ]}
                onChange={(v) =>
                  setConfig({ voiceInput: { ...config.voiceInput, porcupineKeyword: v } })
                }
              />
              <SecretField
                label="Picovoice AccessKey"
                hint="Free at console.picovoice.ai. Required for hands-free wake word."
                present={secrets.PICOVOICE_ACCESS_KEY}
                onSave={(v) => setSecret("PICOVOICE_ACCESS_KEY", v)}
              />
            </>
          )}
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
        </Section>

        <Section title="Voice visualization">
          <ThemePicker
            value={config.appearance.theme}
            onChange={(id) => setConfig({ appearance: { theme: id } })}
          />
        </Section>

        <Section title="Language model">
          <TextField
            label="Model"
            hint="AI Gateway model id, e.g. anthropic/claude-sonnet-4-6 or openai/gpt-5."
            value={config.llm.model}
            onChange={(v) => setConfig({ llm: { model: v } })}
          />
          <SecretField
            label="AI Gateway API key"
            present={secrets.AI_GATEWAY_API_KEY}
            onSave={(v) => setSecret("AI_GATEWAY_API_KEY", v)}
          />
          <SecretField
            label="Tavily API key (web search)"
            hint="Optional — enables the web-search tool."
            present={secrets.TAVILY_API_KEY}
            onSave={(v) => setSecret("TAVILY_API_KEY", v)}
          />
        </Section>

        <Section title="Voice (text-to-speech)">
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
                onChange={(v) => setConfig({ tts: { elevenLabs: { ...config.tts.elevenLabs, voiceId: v } } })}
              />
              <TextField
                label="Model"
                value={config.tts.elevenLabs.modelId}
                onChange={(v) => setConfig({ tts: { elevenLabs: { ...config.tts.elevenLabs, modelId: v } } })}
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
        </Section>

        <Section title="Greeting">
          <SelectField
            label="Proactive greeting"
            hint="What the assistant says the first time you wake it."
            value={config.greeting.mode}
            options={[
              { value: "example", label: "Example briefing (CoreViz demo)" },
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
        </Section>

        <div className="py-6 text-xs text-white/30">
          {data.encryptionAvailable
            ? "API keys are encrypted with your OS keychain."
            : "Warning: OS keychain unavailable — API keys are stored obfuscated, not encrypted."}
        </div>
      </div>
    </div>
  );
}
