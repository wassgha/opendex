import catalog from "./catalog.json";
import type { UsageCharge, UsageUnits } from "./types";

export const unknownCharge = (basis = "This connection did not report enough usage or pricing."): UsageCharge => ({ usd: null, confidence: "unavailable", basis });
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function quantity(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
export function modelIdentity(model: string | { modelId: string; provider: string }) {
  return typeof model === "string" ? { provider: "gateway", model } : { provider: model.provider.split(".")[0], model: model.modelId };
}
export function languageUnits(value: unknown): UsageUnits {
  const u = object(value), input = object(u.inputTokenDetails);
  return cleanUnits({ inputTokens: quantity(u.inputTokens), outputTokens: quantity(u.outputTokens), cachedTokens: quantity(input.cacheReadTokens ?? u.cachedInputTokens), cacheWriteTokens: quantity(input.cacheWriteTokens) });
}
export function cleanUnits(units: UsageUnits): UsageUnits {
  const keys = new Set(["inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "audioInputTokens", "audioOutputTokens", "cachedAudioTokens", "seconds", "characters", "credits", "requests"]);
  return Object.fromEntries(Object.entries(units).filter(([key, n]) => keys.has(key) && typeof n === "number" && Number.isFinite(n) && n >= 0));
}
export function realtimeUnits(raw: unknown): UsageUnits {
  const root = object(raw), response = object(root.response), u = object(response.usage ?? root.usage);
  const input = object(u.input_token_details), output = object(u.output_token_details), cached = object(input.cached_tokens_details);
  return cleanUnits({ inputTokens: quantity(u.input_tokens), outputTokens: quantity(u.output_tokens), cachedTokens: quantity(input.cached_tokens), audioInputTokens: quantity(input.audio_tokens), audioOutputTokens: quantity(output.audio_tokens), cachedAudioTokens: quantity(cached.audio_tokens) });
}
export function reportedCharge(metadata: unknown): UsageCharge | undefined {
  const g = object(object(metadata).gateway);
  const usd = quantity(g.cost);
  return usd === undefined ? undefined : { usd, confidence: "reported", basis: "Vercel AI Gateway reported request cost; credits, taxes and other account charges are separate." };
}

/** Rates are snapshotted on every entry. Never rewrite past costs when pricing changes. */
export function priceUsage(provider: string, model: string, u: UsageUnits, realtime = false): UsageCharge {
  if (provider === "apple" || model === "apple-on-device") return { usd: 0, confidence: "local", basis: "On-device model: no API charge." };
  let id = provider === "gateway" ? model : `${provider}/${model}`;
  id = id.replace("claude-sonnet-4-6", "claude-sonnet-4.6").replace("claude-opus-4-8", "claude-opus-4.8").replace("claude-haiku-4-5-20251001", "claude-haiku-4.5");
  const raw = object(object(catalog.rates)[id]);
  const input = quantity(raw.input), output = quantity(raw.output), cached = quantity(raw.input_cache_read), write = quantity(raw.input_cache_write);
  if (u.inputTokens === undefined || u.outputTokens === undefined || input === undefined || output === undefined) return unknownCharge();
  const cache = u.cachedTokens ?? 0, cacheWrite = u.cacheWriteTokens ?? 0;
  if (cache + cacheWrite > u.inputTokens || (cache > 0 && cached === undefined) || (cacheWrite > 0 && write === undefined)) return unknownCharge("Cache usage cannot be priced reliably.");
  const rates: Record<string, number> = { input, output, ...(cached !== undefined ? { cached } : {}), ...(write !== undefined ? { cacheWrite: write } : {}) };
  let usd: number;
  if (realtime) {
    const ai = u.audioInputTokens, ao = u.audioOutputTokens;
    const audioInput = quantity(raw.audio_input_token_cost), audioOutput = quantity(raw.audio_output_token_cost);
    // Explicit cached-audio price, verified separately because the gateway catalog omits it.
    // https://developers.openai.com/api/docs/models/gpt-realtime-2 (2026-09-08)
    const audioCache = id === "openai/gpt-realtime-2" ? 0.0000004 : undefined;
    const cachedAudio = cache === 0 ? 0 : u.cachedAudioTokens;
    if (ai === undefined || ao === undefined || audioInput === undefined || audioOutput === undefined || cachedAudio === undefined || (cachedAudio > 0 && audioCache === undefined) || cacheWrite > 0 || ai > u.inputTokens || ao > u.outputTokens || cachedAudio > ai || cachedAudio > cache || cache - cachedAudio > u.inputTokens - ai) return unknownCharge("Realtime audio or cached-audio pricing is incomplete.");
    rates.audioInput = audioInput; rates.audioOutput = audioOutput;
    if (audioCache !== undefined) rates.cachedAudio = audioCache;
    usd = (u.inputTokens - ai - cache + cachedAudio) * input + (ai - cachedAudio) * audioInput + (cache - cachedAudio) * (cached ?? 0) + cachedAudio * (audioCache ?? 0) + (u.outputTokens - ao) * output + ao * audioOutput;
  } else {
    usd = (u.inputTokens - cache - cacheWrite) * input + cache * (cached ?? 0) + cacheWrite * (write ?? 0) + u.outputTokens * output;
  }
  return { usd, confidence: "estimated", rates, pricedAt: catalog.asOf, basis: `Standard list-rate estimate from ${catalog.source}. Routing, long context, service tiers, discounts and subscriptions may change the bill.` };
}

export function transcriptionCharge(model: string, seconds: number | undefined): UsageCharge {
  const perMinute = ({ "gpt-4o-transcribe": 0.006, "gpt-4o-mini-transcribe": 0.003, "gpt-transcribe": 0.0045 } as Record<string, number>)[model];
  return seconds === undefined || perMinute === undefined ? unknownCharge() : { usd: seconds / 60 * perMinute, confidence: "estimated", rates: { perMinute }, pricedAt: "2026-09-08", basis: "OpenAI published approximate cost per audio minute: https://developers.openai.com/api/docs/pricing. Actual token billing can differ." };
}

export function wavSeconds(wav: Buffer): number | undefined {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return undefined;
  let byteRate: number | undefined, dataSize: number | undefined;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const size = wav.readUInt32LE(pos + 4), tag = wav.toString("ascii", pos, pos + 4);
    if (pos + 8 + size > wav.length) return undefined;
    if (tag === "fmt " && size >= 16) byteRate = wav.readUInt32LE(pos + 16);
    if (tag === "data") dataSize = size;
    pos += 8 + size + size % 2;
  }
  return byteRate && dataSize !== undefined ? dataSize / byteRate : undefined;
}
