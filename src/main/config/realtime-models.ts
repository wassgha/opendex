// Realtime speech-to-speech model metadata: pure data, no dependencies, so both
// the main process (session init) and the renderer (settings/onboarding pickers)
// can import it as a value — same pattern as llm-providers.ts.

export interface RealtimeVoiceMeta {
  id: string;
  label: string;
}

export interface RealtimeModelMeta {
  /** Gateway slash-form model id. */
  id: string;
  label: string;
  blurb: string;
  /** Voices the model accepts in the session config. Empty = the model picks
   *  its default and the voice selector is hidden. */
  voices: RealtimeVoiceMeta[];
  /** Whether the model can transcribe speech. When false (grok-voice is
   *  speech-to-speech only) the transcript UI gets no text for the session —
   *  audio still flows both ways. */
  transcribes: boolean;
}

export const REALTIME_MODELS: RealtimeModelMeta[] = [
  {
    id: "openai/gpt-realtime-2",
    label: "OpenAI GPT Realtime 2",
    blurb: "OpenAI's flagship speech-to-speech model. Natural voices, tool calling.",
    voices: [
      { id: "marin", label: "Marin" },
      { id: "cedar", label: "Cedar" },
      { id: "alloy", label: "Alloy" },
      { id: "echo", label: "Echo" },
      { id: "sage", label: "Sage" },
      { id: "verse", label: "Verse" },
    ],
    transcribes: true,
  },
  {
    id: "xai/grok-voice-think-fast-1.0",
    label: "xAI Grok Voice (think fast)",
    blurb:
      "xAI's realtime voice model. Speech-to-speech only — no transcripts, so the conversation won't show as text.",
    voices: [],
    transcribes: false,
  },
];

export function getRealtimeModelMeta(id: string): RealtimeModelMeta | undefined {
  return REALTIME_MODELS.find((m) => m.id === id);
}
