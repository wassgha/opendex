import { useEffect, useRef, useState } from "react";
import { Check, Cloud, Cpu, KeyRound, Network, type LucideIcon } from "lucide-react";
import type {
  DeepPartial,
  LlmProvider,
  OpenDexConfig,
  PublicConfig,
  SecretName,
} from "../../../../main/config/schema";
import {
  LLM_PROVIDERS,
  getProviderMeta,
  type LlmProviderMeta,
} from "../../../../main/config/llm-providers";
import { SecretField, SelectField, TextField } from "../ui/fields";

/** Per-provider glyph — conveys the kind at a glance (on-device / key / cloud). */
const PROVIDER_ICON: Record<LlmProvider, LucideIcon> = {
  apple: Cpu,
  openai: KeyRound,
  anthropic: KeyRound,
  xai: KeyRound,
  gateway: Network,
  opendex: Cloud,
};

const CUSTOM = "__custom__";

/** First curated model for a provider, or "" when it has none (apple/opendex). */
export function defaultModelFor(id: LlmProvider): string {
  return getProviderMeta(id)?.models[0]?.id ?? "";
}

interface AppleState {
  loading: boolean;
  available: boolean;
  reason?: string;
}

/** Whether the configured provider has everything it needs to actually run —
 *  used to gate the onboarding "Continue" button. */
export function isProviderReady(
  data: PublicConfig,
  provider: LlmProvider | null,
  apple: { available: boolean },
): boolean {
  if (!provider) return false;
  const meta = getProviderMeta(provider);
  if (!meta || meta.comingSoon) return false;
  if (meta.auth === "none") return provider === "apple" ? apple.available : true;
  if (meta.auth === "account") return false;
  // key auth: needs the secret present and a model chosen.
  return Boolean(meta.secretName && data.secrets[meta.secretName] && data.config.llm.model);
}

export function useAppleAvailability(): AppleState {
  const [state, setState] = useState<AppleState>({ loading: true, available: false });
  useEffect(() => {
    if (window.opendex.platform !== "darwin") {
      setState({ loading: false, available: false, reason: "Requires macOS on Apple Silicon" });
      return;
    }
    let active = true;
    window.opendex
      .appleAvailability()
      .then((r) => active && setState({ loading: false, ...r }))
      .catch(
        () =>
          active &&
          setState({ loading: false, available: false, reason: "Apple Intelligence is unavailable" }),
      );
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/**
 * The language-model provider chooser, shared by onboarding and Settings. The
 * caller owns which provider is "selected" (so onboarding can start with none
 * chosen — no default). Selecting a provider writes `llm.provider` and resets
 * `llm.model` to that provider's default.
 */
export function ProviderPicker({
  data,
  selected,
  onSelect,
  setConfig,
  setSecret,
  apple,
}: {
  data: PublicConfig;
  selected: LlmProvider | null;
  onSelect: (id: LlmProvider) => void;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
  apple: AppleState;
}) {
  const isMac = window.opendex.platform === "darwin";
  // Hide Apple entirely off-Mac; show it disabled-with-reason on Macs.
  const providers = LLM_PROVIDERS.filter((p) => !(p.id === "apple" && !isMac));
  const meta = selected ? getProviderMeta(selected) : undefined;

  // When the user picks a configurable provider, reveal its model/key section.
  // Only scroll on an actual change (not on mount — so opening Settings, where a
  // provider is already selected, doesn't jump; also StrictMode-safe). `nearest`
  // nudges just the scroll container, never outer ancestors/the sidebar.
  const configRef = useRef<HTMLDivElement>(null);
  const prevSelected = useRef(selected);
  useEffect(() => {
    if (prevSelected.current === selected) return;
    prevSelected.current = selected;
    if (!selected || getProviderMeta(selected)?.comingSoon) return;
    const id = requestAnimationFrame(() =>
      configRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
    return () => cancelAnimationFrame(id);
  }, [selected]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            meta={p}
            selected={selected === p.id}
            apple={apple}
            onSelect={() => onSelect(p.id)}
          />
        ))}
      </div>
      {meta && !meta.comingSoon && (
        <div ref={configRef} className="scroll-mb-24">
          <ProviderConfig data={data} meta={meta} setConfig={setConfig} setSecret={setSecret} apple={apple} />
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  meta,
  selected,
  apple,
  onSelect,
}: {
  meta: LlmProviderMeta;
  selected: boolean;
  apple: AppleState;
  onSelect: () => void;
}) {
  const Icon = PROVIDER_ICON[meta.id];
  const appleUnavailable = meta.id === "apple" && !apple.loading && !apple.available;
  const disabled = meta.comingSoon || appleUnavailable;

  // Short, tag-style chip on the right (the full reason goes in the body, in
  // sentence case, so it never shouts or overflows the chip).
  const chip = meta.comingSoon
    ? "Coming soon"
    : meta.id === "apple"
      ? apple.loading
        ? "Checking…"
        : apple.available
          ? "Free"
          : "Unavailable"
      : meta.id === "gateway"
        ? "Advanced"
        : undefined;

  const body = appleUnavailable && apple.reason ? apple.reason : meta.blurb;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${selected
          ? "border-ring bg-secondary ring-1 ring-ring/40"
          : disabled
            ? "border-input bg-card/40"
            : "border-input bg-card/40 hover:border-ring/60 hover:bg-card/70"
        } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition ${selected
            ? "border-ring/50 bg-background text-foreground"
            : disabled
              ? "border-border bg-background/60 text-muted-foreground"
              : "border-border bg-background/60 text-muted-foreground group-hover:text-foreground/80"
          }`}
      >
        <Icon className="size-4" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground/90">{meta.label}</span>
          {chip && (
            <span className="shrink-0 rounded-full border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {chip}
            </span>
          )}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">{body}</span>
      </span>

      {selected && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function ProviderConfig({
  data,
  meta,
  setConfig,
  setSecret,
  apple,
}: {
  data: PublicConfig;
  meta: LlmProviderMeta;
  setConfig: (patch: DeepPartial<OpenDexConfig>) => void;
  setSecret: (name: SecretName, value: string) => void;
  apple: AppleState;
}) {
  const model = data.config.llm.model;
  const knownModel = meta.models.some((m) => m.id === model);
  // Track "custom id" mode locally so picking Custom doesn't immediately wipe
  // the field. Recompute on provider change AND when the model becomes known —
  // selecting a provider sets its default model via an async config write, and
  // until that lands the (stale) model looks unknown; without this the picker
  // would stay stuck on "Custom…" instead of settling on the default model.
  const [custom, setCustom] = useState(meta.models.length > 0 && !knownModel);
  useEffect(() => {
    setCustom(meta.models.length > 0 && !knownModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, knownModel]);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {meta.id === "apple" ? (
        <p className="text-xs text-muted-foreground">
          {apple.available
            ? meta.note
            : apple.reason ?? "Apple Intelligence is unavailable on this device."}
        </p>
      ) : meta.models.length > 0 ? (
        <>
          <SelectField
            label="Model"
            value={custom ? CUSTOM : model}
            options={[
              ...meta.models.map((m) => ({ value: m.id, label: m.label })),
              { value: CUSTOM, label: "Custom…" },
            ]}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustom(true);
              } else {
                setCustom(false);
                setConfig({ llm: { provider: meta.id, model: v } });
              }
            }}
          />
          {custom && (
            <TextField
              label="Custom model id"
              hint={
                meta.id === "gateway"
                  ? "Provider/model form, e.g. anthropic/claude-sonnet-4-6."
                  : "Exact model id for this provider."
              }
              value={model}
              onChange={(v) => setConfig({ llm: { provider: meta.id, model: v } })}
            />
          )}
        </>
      ) : null}

      {meta.auth === "key" && meta.secretName && (
        <SecretField
          label={`${meta.label} API key`}
          hint={
            meta.keyUrl ? (
              <>
                Required to think and reply.{" "}
                <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  Get a key →
                </a>
              </>
            ) : (
              "Required to think and reply."
            )
          }
          present={data.secrets[meta.secretName]}
          onSave={(v) => setSecret(meta.secretName!, v)}
        />
      )}
    </div>
  );
}
