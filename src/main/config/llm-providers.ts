// Metadata describing the LLM providers OpenDex can route chat through. This
// file is intentionally dependency-free (no electron/node/ai imports) so it can
// be imported as a *value* from both the main process (the model resolver in
// agent/llm/resolve-model.ts) and the renderer (the provider picker UI). The
// resolver maps each provider id to a concrete AI SDK model instance.

import type { LlmProvider, ProviderAuth, SecretName } from "./schema";

export interface ModelOption {
  /** Model id passed to the provider (or the gateway slash-form). */
  id: string;
  label: string;
}

export interface LlmProviderMeta {
  id: LlmProvider;
  label: string;
  /** One-line description shown in the picker. */
  blurb: string;
  /** local = on-device/free · byok = bring your own key · managed = hosted by us. */
  kind: "local" | "byok" | "managed";
  auth: ProviderAuth;
  /** The secret it needs, when `auth === "key"`. */
  secretName?: SecretName;
  /** Curated model ids. Empty for fixed/local (apple) or unimplemented (opendex).
   *  Direct/gateway providers also allow a free-text custom id in the UI. */
  models: ModelOption[];
  /** Whether the provider's models can drive tools (skills + computer-use). */
  supportsTools: boolean;
  /** Where to get a key (deep link), shown beside the key field. */
  keyUrl?: string;
  /** Platforms the provider runs on. Omitted = all. */
  platforms?: NodeJS.Platform[];
  /** Reserved but not yet implemented — renders disabled in the picker. */
  comingSoon?: boolean;
  /** Optional caveat surfaced under the provider (e.g. on-device tool limits). */
  note?: string;
}

export const LLM_PROVIDERS: LlmProviderMeta[] = [
  {
    id: "opendex",
    label: "OpenDex",
    blurb: "A simple, private and secure subscription service.",
    kind: "managed",
    auth: "account",
    supportsTools: true,
    comingSoon: true,
    models: [],
  },
  {
    id: "apple",
    label: "Apple Intelligence",
    blurb: "Runs on your Mac, free and fully private.",
    kind: "local",
    auth: "none",
    models: [{ id: "apple-on-device", label: "Apple on-device model" }],
    supportsTools: true,
    platforms: ["darwin"],
    note: "Runs entirely on your Mac. The on-device model is small — for heavy computer-use, a cloud provider is more reliable.",
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "Use your own OpenAI API key.",
    kind: "byok",
    auth: "key",
    secretName: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    supportsTools: true,
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    blurb: "Use your own Anthropic API key.",
    kind: "byok",
    auth: "key",
    secretName: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    supportsTools: true,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    blurb: "Advanced — one key, any provider. Use a provider/model id.",
    kind: "byok",
    auth: "key",
    secretName: "AI_GATEWAY_API_KEY",
    keyUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai%2Fapi-keys&title=AI+Gateway+API+Key",
    supportsTools: true,
    models: [
      { id: "anthropic/claude-sonnet-4-6", label: "anthropic/claude-sonnet-4-6" },
      { id: "openai/gpt-5", label: "openai/gpt-5" },
      { id: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro" },
    ],
  },
];

export function getProviderMeta(id: LlmProvider): LlmProviderMeta | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}
