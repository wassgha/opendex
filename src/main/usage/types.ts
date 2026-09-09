export type UsageCategory = "conversation" | "realtime" | "screen" | "transcription" | "speech" | "search" | "external-agent";
export type UsageUnits = Partial<Record<"inputTokens" | "outputTokens" | "cachedTokens" | "cacheWriteTokens" | "audioInputTokens" | "audioOutputTokens" | "cachedAudioTokens" | "seconds" | "characters" | "credits" | "requests", number>>;
export interface UsageCharge {
  usd: number | null;
  confidence: "reported" | "estimated" | "unavailable" | "local";
  basis: string;
  rates?: Record<string, number>;
  pricedAt?: string;
}
export interface UsageRecord extends UsageCharge {
  id: string;
  runId: string;
  groupId: string;
  startedAt: string;
  finishedAt?: string;
  provider: string;
  model: string;
  category: UsageCategory;
  status: "pending" | "completed" | "interrupted";
  units: UsageUnits;
}
export interface UsageTotal {
  usd: number;
  estimated: number;
  reported: number;
  unavailable: number;
  pending: number;
  requests: number;
}
export interface UsageSummary {
  since: string | null;
  runStartedAt: string;
  updatedAt: string;
  error: string | null;
  launch: UsageTotal;
  today: UsageTotal;
  month: UsageTotal;
  all: UsageTotal;
  connections: Array<{ provider: string; model: string; total: UsageTotal }>;
  categories: Array<{ category: UsageCategory; total: UsageTotal }>;
}
export interface UsageHistory { records: UsageRecord[]; total: number }
