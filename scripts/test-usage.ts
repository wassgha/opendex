import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger } from "../src/main/usage/ledger";
import { languageUnits, priceUsage, realtimeUnits, reportedCharge, transcriptionCharge, unknownCharge, wavSeconds } from "../src/main/usage/pricing";

function withLedger(run: (ledger: UsageLedger, directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "dex-usage-"));
  try { run(new UsageLedger(directory), directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
test("persistent accounting, idempotent completion and crash recovery", () => withLedger((ledger, dir) => {
  const id = ledger.start({ provider: "openai", model: "gpt-5", category: "conversation", id: "one" });
  assert.equal(ledger.summary().launch.pending, 1);
  ledger.finish(id, { inputTokens: 100 }, { usd: 0.25, confidence: "reported", basis: "test" });
  ledger.finish(id, {}, { usd: 100, confidence: "reported", basis: "duplicate" });
  ledger.start({ provider: "gateway", model: "custom", category: "realtime", id: "crash" });
  assert.equal(ledger.summary().all.usd, 0.25);
  const reopened = new UsageLedger(dir);
  assert.equal(reopened.summary().all.usd, 0.25);
  assert.equal(reopened.summary().all.requests, 2);
  assert.equal(reopened.summary().all.unavailable, 1);
  assert.equal(reopened.summary().all.pending, 0);
  assert.equal(reopened.summary().launch.requests, 0);
  assert.equal(reopened.history().records.find(r => r.id === "crash")?.status, "interrupted");
}));
test("incomplete journal tail doesn't hide later entries or silently reset totals", () => withLedger((ledger, dir) => {
  const id = ledger.start({ provider: "openai", model: "gpt-5", category: "screen" });
  ledger.finish(id, {}, { usd: 0.12, confidence: "estimated", basis: "test" });
  appendFileSync(join(dir, "ledger.jsonl"), '{"id":');
  const reopened = new UsageLedger(dir);
  const next = reopened.start({ provider: "tavily", model: "basic", category: "search" });
  reopened.finish(next, { credits: 1 }, unknownCharge());
  const again = new UsageLedger(dir);
  assert.equal(again.summary().all.usd, 0.12);
  assert.equal(again.summary().all.requests, 2);
  assert.match(again.summary().error!, /incomplete/);
}));
test("journal stores allowlisted counters, no arbitrary metadata", () => withLedger((ledger, dir) => {
  const id = ledger.start({ provider: "openai", model: "gpt-5", category: "conversation" });
  ledger.finish(id, { inputTokens: 1, outputTokens: NaN, prompt: "PRIVATE" } as never, unknownCharge());
  assert.ok(!readFileSync(join(dir, "ledger.jsonl"), "utf8").includes("PRIVATE"));
  assert.deepEqual(ledger.history().records[0].units, { inputTokens: 1 });
}));
test("local calendar boundaries and launch scope remain independent", () => withLedger((ledger) => {
  const id = ledger.start({ provider: "openai", model: "gpt-5", category: "conversation" });
  ledger.finish(id, {}, { usd: 2, confidence: "reported", basis: "test" });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(12, 0, 0, 0);
  assert.equal(ledger.summary(tomorrow).today.usd, 0);
  assert.equal(ledger.summary(tomorrow).launch.usd, 2);
  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
  assert.equal(ledger.summary(nextMonth).month.usd, 0);
}));
test("cached input is not counted twice; output includes reasoning already", () => {
  const units = languageUnits({ inputTokens: 1000, outputTokens: 200, inputTokenDetails: { cacheReadTokens: 400 }, outputTokenDetails: { reasoningTokens: 150 } });
  const price = priceUsage("openai", "gpt-5", units);
  assert.equal(price.confidence, "estimated");
  assert.ok(Math.abs(price.usd! - 0.0028) < 1e-10);
  assert.equal(priceUsage("openai", "unknown", units).usd, null);
  assert.equal(priceUsage("openai", "gpt-5", {}).usd, null);
  assert.equal(priceUsage("openai", "gpt-5", { inputTokens: 1, outputTokens: 1, cachedTokens: 2 }).usd, null);
  assert.equal(priceUsage("apple", "apple-on-device", {}).usd, 0);
});
test("realtime modalities and audio caching use their own prices", () => {
  const units = realtimeUnits({ response: { usage: { input_tokens: 1000, output_tokens: 200, input_token_details: { audio_tokens: 600, cached_tokens: 200, cached_tokens_details: { audio_tokens: 100 } }, output_token_details: { audio_tokens: 150 } } } });
  const quote = priceUsage("gateway", "openai/gpt-realtime-2", units, true);
  assert.ok(Math.abs(quote.usd! - (300 * 0.000004 + 500 * 0.000032 + 200 * 0.0000004 + 50 * 0.000024 + 150 * 0.000064)) < 1e-10);
  assert.equal(priceUsage("gateway", "openai/gpt-realtime-2", { inputTokens: 1000, outputTokens: 200 }, true).usd, null);
  assert.equal(priceUsage("gateway", "openai/gpt-realtime-2", { ...units, cachedAudioTokens: undefined }, true).usd, null);
});
test("provider-reported zero is valid, missing/invalid metadata stays unknown", () => {
  assert.equal(reportedCharge({ gateway: { cost: "0" } })?.usd, 0);
  assert.equal(reportedCharge({ gateway: { cost: "0.025" } })?.confidence, "reported");
  for (const cost of [null, undefined, -1, Infinity, "garbage", ""]) assert.equal(reportedCharge({ gateway: { cost } }), undefined);
});
test("WAV duration parses chunks rather than guessing from total file size", () => {
  const wav = Buffer.alloc(44 + 32000); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt32LE(32000, 28); wav.write("data", 36); wav.writeUInt32LE(32000, 40);
  assert.equal(wavSeconds(wav), 1);
  assert.equal(wavSeconds(wav.subarray(0, 100)), undefined);
  assert.equal(transcriptionCharge("gpt-4o-transcribe", 60).usd, 0.006);
  assert.equal(transcriptionCharge("custom", 60).usd, null);
});
test("closing one realtime group leaves other concurrent work alone", () => withLedger((ledger) => {
  ledger.start({ provider: "gateway", model: "voice", category: "realtime", groupId: "voice" });
  ledger.start({ provider: "openai", model: "gpt-5", category: "conversation", groupId: "task" });
  ledger.interruptGroup("voice");
  assert.equal(ledger.summary().all.pending, 1);
  assert.equal(ledger.summary().all.unavailable, 1);
}));

test("real chat loop records every tool-loop step exactly once", async () => {
  const { MockLanguageModelV3 } = await import("ai/test");
  const { simulateReadableStream, tool } = await import("ai");
  const { z } = await import("zod");
  const { streamChat } = await import("../src/main/agent/chat");
  const { initUsage, usageHistory, usageSummary } = await import("../src/main/usage/ledger");
  const directory = mkdtempSync(join(tmpdir(), "dex-chat-usage-"));
  try {
    initUsage(directory, () => {});
    let step = 0;
    const model = new MockLanguageModelV3({ provider: "gateway", modelId: "openai/gpt-5", doStream: async () => {
      const first = step++ === 0;
      return { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
        { type: "stream-start", warnings: [] },
        ...(first ? [{ type: "tool-call", toolCallId: "clock-call", toolName: "clock", input: "{}" }] : [{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "Done." }, { type: "text-end", id: "text" }]),
        { type: "finish", finishReason: { unified: first ? "tool-calls" : "stop", raw: first ? "tool_calls" : "stop" }, usage: { inputTokens: { total: first ? 100 : 200, noCache: first ? 100 : 200, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } }, providerMetadata: { gateway: { cost: first ? "0.01" : "0.02" } } },
      ] as never }) };
    } });
    await streamChat({ model, system: "Accounting test", messages: [{ role: "user", content: "Use the clock." }], tools: { clock: tool({ inputSchema: z.object({}), execute: async () => "12:00" }) }, onDelta: () => {} });
    const rows = usageHistory(0).records;
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.groupId)).size, 1);
    assert.deepEqual(rows.map(row => row.units.inputTokens).sort(), [100, 200]);
    assert.equal(usageSummary().all.usd, 0.03);
    assert.equal(usageSummary().all.pending, 0);
    assert.equal(usageSummary().all.unavailable, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
