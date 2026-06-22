const FEATURES = [
  {
    title: "Voice-first loop",
    body: "Wake word → listen → think (with tools) → speak. Natural follow-ups, plus opt-in barge-in to interrupt mid-reply.",
  },
  {
    title: "Any model",
    body: "Routes through the Vercel AI Gateway, so one key gets you Claude, GPT, Gemini, and more.",
  },
  {
    title: "Free & offline option",
    body: "Vosk wake word + local Whisper transcription (WASM, no signup) and your OS's built-in voice. Nothing leaves the machine except the LLM call.",
  },
  {
    title: "Pluggable voice I/O",
    body: "Wake via push-to-talk, Vosk, Porcupine, or Web Speech; transcribe locally or in the cloud; speak via ElevenLabs or system TTS.",
  },
  {
    title: "Full-interface themes",
    body: "The theme is the whole UI: a cinematic Jarvis HUD, a minimal Talking Dot, a Typing Cursor terminal, or a warm Editorial layout — all reactive to your voice.",
  },
  {
    title: "Agentic skills, gated",
    body: "The agent takes real actions (open apps & URLs). Sensitive ones hit an Allow once / Always / Deny prompt, remembered per skill.",
  },
  {
    title: "Computer-use (opt-in)",
    body: "Let it see the screen and drive the mouse & keyboard to operate apps for you. Works with any vision model, behind the permission gate.",
  },
  {
    title: "Secure by design",
    body: "API keys are encrypted with your OS keychain and live only in the main process — never in the UI.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-neutral-100 bg-neutral-50/60">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-neutral-400">
          What it does
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <div key={feature.title} className="flex gap-5">
              <span className="text-sm font-bold text-neutral-300">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-bold">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-neutral-500">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
