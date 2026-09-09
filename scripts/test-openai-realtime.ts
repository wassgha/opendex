import { test } from "node:test";
import { strict as assert } from "node:assert";
import { openaiRealtimeCodec as codec } from "../src/main/agent/realtime/openai-codec";
import { confirmedTurnOptions } from "../src/main/agent/realtime/confirmed-turn-config";
import { connectRealtime } from "../src/main/agent/realtime/connection";
import { realtimeModelsFor, realtimeSecretName } from "../src/main/config/realtime-models";
import { realtimeUnits } from "../src/main/usage/pricing";
import { groundedTurnInstructions } from "../src/main/agent/realtime/turn-grounding";

test("direct accepted turns replace input audio with the visible text and preserve base instructions", async () => {
  assert.deepEqual(codec.serializeItemDelete?.("input"), { type: "conversation.item.delete", item_id: "input" });
  assert.deepEqual(await codec.serializeClientEvent({ type: "conversation-item-create", item: { type: "text-message", role: "user", text: "Run diagnostics." } }), {
    type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "Run diagnostics." }] },
  });
  const instructions = groundedTurnInstructions("Keep permission rules.", "Run diagnostics.");
  const response = await codec.serializeClientEvent({ type: "response-create", options: { instructions } }) as any;
  assert.equal(response.response.instructions, instructions);
  assert.match(instructions, /^Keep permission rules\./);
  assert.match(instructions, /Latest accepted user text.*"Run diagnostics\."/);
  assert.match(instructions, /Call tools only to fulfill the accepted request/);
});

test("direct session uses GA audio schema and preserves confirmed speech gating", async () => {
  const wire = await codec.serializeClientEvent({ type: "session-update", config: {
    instructions: "Test", voice: "marin", providerOptions: confirmedTurnOptions("marin", "openai"),
    tools: [{ type: "function", name: "clock", description: "Time", parameters: { type: "object" } }],
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(wire)), {
    type: "session.update", session: {
      type: "realtime", instructions: "Test", output_modalities: ["audio"],
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
          turn_detection: { type: "semantic_vad", eagerness: "high", create_response: false, interrupt_response: false } },
        output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
      }, tools: [{ type: "function", name: "clock", description: "Time", parameters: { type: "object" } }],
    },
  });
  assert.equal(confirmedTurnOptions("marin").audio.input.transcription.model, "gpt-realtime-whisper");
});

test("audio, transcription, tool result, cancellation and response events translate", async () => {
  assert.deepEqual(await codec.serializeClientEvent({ type: "input-audio-append", audio: "AQI=" }), { type: "input_audio_buffer.append", audio: "AQI=" });
  assert.deepEqual(await codec.serializeClientEvent({ type: "conversation-item-create", item: { type: "function-call-output", callId: "call1", name: "clock", output: "{}" } }),
    { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call1", output: "{}" } });
  assert.deepEqual(await codec.serializeClientEvent({ type: "response-cancel" }), { type: "response.cancel" });
  const fixtures = [
    [{ type: "input_audio_buffer.speech_started", item_id: "in1" }, "speech-started"],
    [{ type: "input_audio_buffer.speech_stopped", item_id: "in1" }, "speech-stopped"],
    [{ type: "conversation.item.input_audio_transcription.completed", item_id: "in1", transcript: "hello" }, "input-transcription-completed"],
    [{ type: "response.output_audio.delta", response_id: "r1", item_id: "out1", delta: "AQI=" }, "audio-delta"],
    [{ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "out1", delta: "Hello" }, "audio-transcript-delta"],
    [{ type: "response.function_call_arguments.done", response_id: "r1", item_id: "out1", call_id: "call1", name: "clock", arguments: "{}" }, "function-call-arguments-done"],
  ] as const;
  for (const [raw, type] of fixtures) {
    const event = codec.parseServerEvent(raw);
    assert.ok(!Array.isArray(event));
    assert.equal(event.type, type);
    assert.equal(event.raw, raw);
  }
});

test("response usage survives mapping and failed responses surface a reason", () => {
  const raw = { type: "response.done", response: { id: "r", status: "completed", usage: { input_tokens: 10, output_tokens: 5 } } };
  const event = codec.parseServerEvent(raw);
  assert.ok(!Array.isArray(event));
  assert.equal(realtimeUnits(event.raw).inputTokens, 10);
  const failed = codec.parseServerEvent({ type: "response.done", response: { id: "r", status: "failed", status_details: { error: { code: "insufficient_quota", message: "Quota exceeded" } } } });
  assert.ok(Array.isArray(failed));
  assert.equal(failed[1].type, "error");
});

test("provider selection filters Grok and direct key failures never fall back to Gateway", async () => {
  assert.ok(realtimeModelsFor("openai").every(m => m.id.startsWith("openai/")));
  assert.ok(realtimeModelsFor("gateway").some(m => m.id.startsWith("xai/")));
  assert.equal(realtimeSecretName("openai"), "OPENAI_API_KEY");
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(connectRealtime("openai", "openai/gpt-realtime-2"), /Add an OpenAI API key/);
    await assert.rejects(connectRealtime("openai", "xai/grok-voice-think-fast-1.0"), /Choose an OpenAI/);
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  }
});
