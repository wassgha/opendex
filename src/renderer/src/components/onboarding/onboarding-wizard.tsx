import { useState } from "react";
import type {
  DeepPartial,
  OpenDexConfig,
  PublicConfig,
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

interface Step {
  key: string;
  title: string;
  subtitle: string;
  render: () => React.ReactNode;
}

export function OnboardingWizard({
  data,
  setConfig,
  setSecret,
  onComplete,
}: {
  data: PublicConfig;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
  onComplete: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const { config, secrets } = data;
  const voices = useSystemVoices();

  const steps: Step[] = [
    {
      key: "welcome",
      title: "Welcome to OpenDex",
      subtitle: "A voice-first agentic assistant for your desktop. Let's set it up — about a minute.",
      render: () => (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-white/60">
          <div className="text-6xl">🎙️</div>
          <p className="max-w-sm text-sm">
            You'll choose a language model, a voice, and what OpenDex says when you
            first wake it. Everything here can be changed later in Settings.
          </p>
        </div>
      ),
    },
    {
      key: "llm",
      title: "Language model",
      subtitle: "OpenDex routes through the Vercel AI Gateway, so you can use any provider with one key.",
      render: () => (
        <>
          <TextField
            label="Model"
            hint="e.g. anthropic/claude-sonnet-4-6 or openai/gpt-5"
            value={config.llm.model}
            onChange={(v) => setConfig({ llm: { model: v } })}
          />
          <SecretField
            label="AI Gateway API key"
            hint="Required to think and reply."
            present={secrets.AI_GATEWAY_API_KEY}
            onSave={(v) => setSecret("AI_GATEWAY_API_KEY", v)}
          />
        </>
      ),
    },
    {
      key: "voice",
      title: "Voice",
      subtitle: "How OpenDex speaks back to you.",
      render: () => (
        <>
          <SegmentedControl
            value={config.tts.engine}
            options={[
              { value: "elevenlabs", label: "ElevenLabs" },
              { value: "system", label: "System voice (free)" },
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
                hint="Defaults to a deep British voice (George)."
                value={config.tts.elevenLabs.voiceId}
                onChange={(v) =>
                  setConfig({ tts: { elevenLabs: { ...config.tts.elevenLabs, voiceId: v } } })
                }
              />
            </>
          ) : (
            <SelectField
              label="System voice"
              hint={voices.length ? "Uses your operating system's built-in speech — no API key needed." : "Loading voices…"}
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
      ),
    },
    {
      key: "greeting",
      title: "Greeting",
      subtitle: "What OpenDex says the first time you wake it each session.",
      render: () => (
        <>
          <SelectField
            label="Proactive greeting"
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
              hint="What should it say? Include any context you want it to use."
              value={config.greeting.customPrompt}
              placeholder="e.g. Greet me by name, then summarise today's priorities…"
              onChange={(v) => setConfig({ greeting: { ...config.greeting, customPrompt: v } })}
            />
          )}
          {config.greeting.mode === "example" && (
            <p className="text-xs text-white/40">
              Ships with a sample product-metrics briefing so you can hear the
              capability immediately. Swap to a custom prompt anytime.
            </p>
          )}
        </>
      ),
    },
    {
      key: "wake",
      title: "Wake word & name",
      subtitle: "Finally, how you summon it.",
      render: () => (
        <>
          <TextField
            label="Name"
            value={config.assistant.name}
            onChange={(v) => setConfig({ assistant: { name: v } })}
          />
          <TextField
            label="Wake word"
            hint="Say this to start talking. Single, distinct words work best."
            value={config.assistant.wakeWord}
            onChange={(v) => setConfig({ assistant: { wakeWord: v } })}
          />
        </>
      ),
    },
  ];

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050816] p-6">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-white/10 bg-[#0a0f1f] p-7 shadow-2xl">
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full transition ${
                i <= stepIndex ? "bg-cyan-400" : "bg-white/10"
              }`}
            />
          ))}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-white">{step.title}</h2>
          <p className="mt-1 text-sm text-white/50">{step.subtitle}</p>
        </div>

        <div className="flex flex-col gap-4">{step.render()}</div>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            className="rounded-full px-4 py-2 text-sm text-white/50 transition enabled:hover:text-white disabled:opacity-0"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (isLast ? onComplete() : setStepIndex((i) => i + 1))}
            className="rounded-full bg-cyan-400 px-6 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
          >
            {isLast ? "Start using OpenDex" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
