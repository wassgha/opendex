import type { gateway } from "@ai-sdk/gateway";

type GatewayCodec = ReturnType<typeof gateway.experimental_realtime>;
export type RealtimeCodec = Pick<GatewayCodec, "serializeClientEvent" | "parseServerEvent" | "getHealthCheckResponse"> & { serializeItemDelete?: (itemId: string) => unknown };
type ClientEvent = Parameters<RealtimeCodec["serializeClientEvent"]>[0];
type Parsed = ReturnType<RealtimeCodec["parseServerEvent"]>;
type ServerEvent = Exclude<Parsed, unknown[]>;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";

/** OpenAI's GA wire protocol, adapted to the host's existing normalized events.
 * https://developers.openai.com/api/docs/guides/realtime-conversations
 * No credentials or socket state live in this codec.
 */
export const openaiRealtimeCodec: RealtimeCodec = {
  serializeItemDelete: itemId => ({ type: "conversation.item.delete", item_id: itemId }),
  serializeClientEvent(event: ClientEvent): unknown {
    switch (event.type) {
      case "session-update": {
        const c = event.config;
        const vad = c.turnDetection;
        const turnDetection = !vad || vad.type === "disabled" ? null
          : vad.type === "semantic-vad" ? { type: "semantic_vad" }
          : { type: "server_vad", threshold: vad.threshold, silence_duration_ms: vad.silenceDurationMs, prefix_padding_ms: vad.prefixPaddingMs };
        return { type: "session.update", session: {
          type: "realtime",
          instructions: c.instructions,
          output_modalities: c.outputModalities ?? ["audio"],
          audio: {
            input: {
              format: c.inputAudioFormat ?? { type: "audio/pcm", rate: 24000 },
              turn_detection: turnDetection,
              ...(c.inputAudioTranscription ? { transcription: { model: "gpt-4o-mini-transcribe", ...c.inputAudioTranscription } } : {}),
            },
            output: { format: c.outputAudioFormat ?? { type: "audio/pcm", rate: 24000 }, ...(c.voice ? { voice: c.voice } : {}) },
          },
          tools: c.tools,
          ...c.providerOptions,
        } };
      }
      case "input-audio-append": return { type: "input_audio_buffer.append", audio: event.audio };
      case "input-audio-commit": return { type: "input_audio_buffer.commit" };
      case "input-audio-clear": return { type: "input_audio_buffer.clear" };
      case "conversation-item-create": {
        const item = event.item;
        return { type: "conversation.item.create", item: item.type === "function-call-output"
          ? { type: "function_call_output", call_id: item.callId, output: item.output }
          : { type: "message", role: item.role, content: [item.type === "text-message"
            ? { type: "input_text", text: item.text } : { type: "input_audio", audio: item.audio }] } };
      }
      case "conversation-item-truncate": return { type: "conversation.item.truncate", item_id: event.itemId, content_index: event.contentIndex, audio_end_ms: event.audioEndMs };
      case "response-create": return { type: "response.create", ...(event.options ? { response: {
        instructions: event.options.instructions, metadata: event.options.metadata, output_modalities: event.options.modalities,
      } } : {}) };
      case "response-cancel": return { type: "response.cancel" };
    }
  },
  parseServerEvent(raw: unknown): ServerEvent | ServerEvent[] {
    const e = object(raw), response = object(e.response), error = object(e.error);
    const ids = { responseId: string(e.response_id), itemId: string(e.item_id), raw };
    switch (e.type) {
      case "session.created": return { type: "session-created", sessionId: string(object(e.session).id), raw };
      case "session.updated": return { type: "session-updated", raw };
      case "input_audio_buffer.speech_started": return { type: "speech-started", itemId: ids.itemId, raw };
      case "input_audio_buffer.speech_stopped": return { type: "speech-stopped", itemId: ids.itemId, raw };
      case "conversation.item.input_audio_transcription.completed": return { type: "input-transcription-completed", itemId: ids.itemId, transcript: string(e.transcript), raw };
      case "response.created": return { type: "response-created", responseId: string(response.id), raw };
      case "response.done": {
        const done: ServerEvent = { type: "response-done", responseId: string(response.id), status: string(response.status), raw };
        const failure = object(object(response.status_details).error);
        return response.status === "failed" ? [done, { type: "error", message: string(failure.message) || "OpenAI could not complete the voice response.", code: string(failure.code), raw }] : done;
      }
      case "response.output_audio.delta": return { type: "audio-delta", ...ids, delta: string(e.delta) };
      case "response.output_audio.done": return { type: "audio-done", ...ids };
      case "response.output_audio_transcript.delta": return { type: "audio-transcript-delta", ...ids, delta: string(e.delta) };
      case "response.output_text.delta": return { type: "text-delta", ...ids, delta: string(e.delta) };
      case "response.function_call_arguments.done": return { type: "function-call-arguments-done", ...ids, callId: string(e.call_id), name: string(e.name), arguments: string(e.arguments) };
      case "conversation.item.input_audio_transcription.failed":
      case "error": return { type: "error", message: string(error.message) || "OpenAI realtime error.", code: string(error.code), raw };
      default: return { type: "custom", rawType: string(e.type), raw };
    }
  },
};
