/** The OpenAI mapper merges providerOptions at session level. Supply the full
 * audio object so its shallow merge preserves PCM format, voice, and STT.
 */
export function confirmedTurnOptions(voice: string, provider: "gateway" | "openai" = "gateway") {
  return {
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: provider === "openai" ? "gpt-4o-mini-transcribe" : "gpt-realtime-whisper", language: "en" },
        turn_detection: { type: "semantic_vad", eagerness: "high", create_response: false, interrupt_response: false },
      },
      output: { format: { type: "audio/pcm", rate: 24000 }, ...(voice ? { voice } : {}) },
    },
  };
}
