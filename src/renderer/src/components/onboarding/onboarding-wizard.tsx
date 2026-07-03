import { useState } from "react";
import type {
  DeepPartial,
  LlmProvider,
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
import {
  ProviderPicker,
  defaultModelFor,
  isProviderReady,
  useAppleAvailability,
} from "@/components/llm/provider-picker";
import { useSystemVoices } from "@/lib/use-system-voices";
import { ThemePicker } from "@/components/themes/theme-picker";
import {
  REALTIME_MODELS,
  getRealtimeModelMeta,
} from "../../../../main/config/realtime-models";
import { AudioWaveform, Dot, Pencil, SlidersHorizontal } from "lucide-react";

interface Step {
  key: string;
  title: string;
  subtitle: string;
  render: () => React.ReactNode;
}

/** One selectable card in the voice-mode fork step. */
function VoiceModeCard({
  selected,
  onSelect,
  Icon,
  title,
  blurb,
}: {
  selected: boolean;
  onSelect: () => void;
  Icon: typeof AudioWaveform;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
        selected
          ? "border-white/60 bg-white/10"
          : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-white/70" />
      <span>
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-white/50">{blurb}</span>
      </span>
    </button>
  );
}

/** Inline, auto-sizing name field rendered mid-sentence ("…my name is Dex").
 *  The bright text, dashed underline, blinking caret (autofocus) and pencil all
 *  signal it's editable without a separate label. */
function EditableName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center align-baseline">
      <input
        spellCheck={false}
        aria-label="Assistant name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="[field-sizing:content] min-w-[1ch] max-w-[10ch] border-b-2 border-dashed border-white/40 bg-transparent text-center font-semibold text-white caret-white outline-none transition-colors focus:border-solid focus:border-white"
      />
      <Pencil className="pointer-events-none ml-1.5 size-4 text-white/40" />
    </span>
  );
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
  // No default provider: start with none chosen so the user makes a deliberate
  // pick before continuing past the model step.
  const [chosenProvider, setChosenProvider] = useState<LlmProvider | null>(null);
  const apple = useAppleAvailability();
  const { config, secrets } = data;
  const voices = useSystemVoices();

  const steps: Step[] = [
    {
      key: "welcome",
      title: "",
      subtitle: "",
      render: () => (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
          <Dot className="size-24 text-white animate-pulse" />
          <p className="text-3xl font-medium leading-relaxed text-white/45">
            Hi, I'm {" "}
            <EditableName
              value={config.assistant.name}
              // The name doubles as the wake word; power users can split them
              // later in Settings.
              onChange={(v) => setConfig({ assistant: { name: v, wakeWord: v } })}
            />
          </p>
          <p className="text-xs text-white/20">You can rename me anytime in Settings.</p>
        </div>
      ),
    },
    {
      key: "llm",
      title: "Language model",
      subtitle: "Pick where the thinking happens — free on-device, your own API key, or the Vercel gateway.",
      render: () => (
        <ProviderPicker
          data={data}
          selected={chosenProvider}
          onSelect={(id) => {
            setChosenProvider(id);
            setConfig({ llm: { provider: id, model: defaultModelFor(id) } });
          }}
          setConfig={setConfig}
          setSecret={setSecret}
          apple={apple}
        />
      ),
    },
    {
      key: "voicemode",
      title: "How conversations run",
      subtitle: "Two ways to talk to OpenDex — you can switch anytime in Settings.",
      render: () => (
        <div className="flex flex-col gap-3">
          <VoiceModeCard
            selected={config.voice.mode === "pipeline"}
            onSelect={() => setConfig({ voice: { mode: "pipeline" } })}
            Icon={SlidersHorizontal}
            title="Classic pipeline"
            blurb="Separate wake word, transcription, language model, and voice. Free, offline options for every stage, and full control over each."
          />
          <VoiceModeCard
            selected={config.voice.mode === "realtime"}
            onSelect={() => setConfig({ voice: { mode: "realtime" } })}
            Icon={AudioWaveform}
            title="Realtime voice"
            blurb="One speech-to-speech model listens and answers in its own voice — the most natural conversations and the fastest turns. Needs a Vercel AI Gateway key; screen control still runs through your language model."
          />
        </div>
      ),
    },
    ...(config.voice.mode === "realtime"
      ? [
          {
            key: "realtime",
            title: "Realtime voice",
            subtitle: "The model that listens and speaks, and how a conversation starts.",
            render: () => {
              const realtimeMeta = getRealtimeModelMeta(config.realtime.model);
              return (
                <>
                  <SecretField
                    label="Vercel AI Gateway key"
                    hint="Realtime sessions connect through the gateway (same key as the gateway model provider)."
                    present={secrets.AI_GATEWAY_API_KEY}
                    onSave={(v) => setSecret("AI_GATEWAY_API_KEY", v)}
                  />
                  <SelectField
                    label="Realtime model"
                    hint={realtimeMeta?.blurb}
                    value={config.realtime.model}
                    options={REALTIME_MODELS.map((m) => ({ value: m.id, label: m.label }))}
                    onChange={(v) => {
                      const meta = getRealtimeModelMeta(v);
                      setConfig({
                        realtime: {
                          ...config.realtime,
                          model: v,
                          voice: meta?.voices[0]?.id ?? "",
                        },
                      });
                    }}
                  />
                  {realtimeMeta && realtimeMeta.voices.length > 0 && (
                    <SelectField
                      label="Voice"
                      value={config.realtime.voice}
                      options={realtimeMeta.voices.map((v) => ({
                        value: v.id,
                        label: v.label,
                      }))}
                      onChange={(v) =>
                        setConfig({ realtime: { ...config.realtime, voice: v } })
                      }
                    />
                  )}
                  <SelectField
                    label="How a conversation starts"
                    hint="The wake word (or push-to-talk) connects a session; it hangs up after a stretch of silence."
                    value={config.voiceInput.wakeMode}
                    options={[
                      { value: "manual", label: "Push to talk (click / ⌘⇧Space)" },
                      { value: "vosk", label: "Wake word (Vosk — free, offline)" },
                      { value: "webspeech", label: "Wake word (Web Speech)" },
                    ]}
                    onChange={(v) =>
                      setConfig({ voiceInput: { ...config.voiceInput, wakeMode: v } })
                    }
                  />
                  <p className="text-xs text-white/40">
                    Sessions are billed by the provider and capped at twenty-five
                    minutes — the wake word reconnects seamlessly.
                  </p>
                </>
              );
            },
          } satisfies Step,
        ]
      : [
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
      key: "voiceinput",
      title: "Voice input",
      subtitle: "How you start talking, and how speech is transcribed.",
      render: () => (
        <>
          <SelectField
            label="How to start listening"
            hint="Push-to-talk and Vosk need no paid key."
            value={config.voiceInput.wakeMode}
            options={[
              { value: "manual", label: "Push to talk (click / ⌘⇧Space)" },
              { value: "vosk", label: "Wake word (Vosk — free, offline)" },
              { value: "webspeech", label: "Wake word (Web Speech)" },
            ]}
            onChange={(v) => setConfig({ voiceInput: { ...config.voiceInput, wakeMode: v } })}
          />
          <SelectField
            label="Transcription"
            hint="Local options are free + offline (one-time model download)."
            value={config.voiceInput.sttProvider}
            options={[
              { value: "whisper-local", label: "Local Whisper (free, offline)" },
              { value: "vosk-local", label: "Local Vosk (free, offline)" },
              { value: "openai", label: "OpenAI Whisper (cloud)" },
              { value: "webspeech", label: "Web Speech (browser)" },
            ]}
            onChange={(v) => setConfig({ voiceInput: { ...config.voiceInput, sttProvider: v } })}
          />
          {config.voiceInput.sttProvider === "openai" && (
            <SecretField
              label="OpenAI API key"
              present={secrets.OPENAI_API_KEY}
              onSave={(v) => setSecret("OPENAI_API_KEY", v)}
            />
          )}
        </>
      ),
    },
        ]),
    {
      key: "appearance",
      title: "Voice visualization",
      subtitle: "Pick how OpenDex appears while listening and speaking.",
      render: () => (
        <ThemePicker
          value={config.appearance.theme}
          onChange={(id) => setConfig({ appearance: { theme: id } })}
        />
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
              { value: "example", label: "Example briefing (demo)" },
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
  ];

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  // Block advancing past the model step until a provider is chosen and usable,
  // and past the realtime step until the gateway key is saved.
  const blocked =
    (step.key === "llm" && !isProviderReady(data, chosenProvider, apple)) ||
    (step.key === "realtime" && !secrets.AI_GATEWAY_API_KEY);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a] p-0 md:p-6">
      {/* Frameless title bar: a draggable strip across the top, inset from the
          corner controls (brand mark, settings gear) so they stay clickable. */}
      {window.opendex.platform === "darwin" && (
        <div className="titlebar-drag fixed inset-x-[72px] top-0 z-30 h-9" />
      )}

      <div className="flex w-full h-full md:h-auto md:max-h-[85vh] md:max-w-md flex-1 flex-col gap-5 overflow-hidden px-6 pt-6 md:rounded-2xl md:border md:border-white/10 md:bg-[#0e0e0e] md:px-7 md:pt-7 md:shadow-2xl">
        <div className="flex gap-1.5 mt-8 md:mt-0">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full transition ${i <= stepIndex ? "bg-white" : "bg-white/10"
                }`}
            />
          ))}
        </div>

        {step.title && (
          <div>
            <h2 className="text-xl font-semibold text-white">{step.title}</h2>
            <p className="mt-1 text-sm text-white/50">{step.subtitle}</p>
          </div>
        )}

        {/* Scrollable body with an overlaid, blurred bottom bar: content scrolls
            *under* the bar, which stays pinned to the bottom of the card. */}
        <div className="relative -mx-6 min-h-0 flex-1 md:-mx-7">
          <div className="h-full overflow-y-auto px-6 pb-20 md:px-7">
            <div className="flex flex-1 min-h-full flex-col gap-4">{step.render()}</div>
          </div>

          {/* Fade so scrolling content dissolves into the bar instead of clipping. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[64px] h-10 bg-gradient-to-t from-[#0a0a0a] to-transparent md:from-[#0e0e0e]" />

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/10 bg-[#0a0a0a]/80 px-6 py-4 backdrop-blur-md md:bg-[#0e0e0e]/80 md:px-7">
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
              disabled={blocked}
              onClick={() => (isLast ? onComplete() : setStepIndex((i) => i + 1))}
              className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLast ? "Start using OpenDex" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
