# Usage and costs

Dex keeps a local accounting journal at `userData/usage/ledger.jsonl`, separate
from rotating interaction diagnostics. Tracking starts with the first request
made by a build containing this feature; old diagnostic logs and account bills
are not imported.

## What the user sees

The main window and notch display **Since launch** and **Today**. Clicking either
opens Settings → Usage & costs. That page shows launch, local-calendar day,
local-calendar month and all tracked totals; provider/model and activity
breakdowns; and paginated, expandable request history. Connections are grouped
under one provider heading with activity rows and a known-cost subtotal. Input
transcription without billing data says **Cost not reported** and is explicitly
excluded from that subtotal. Voice reconnects do not
reset the launch total. Relaunching Dex does, while historical totals persist.

- `≈` means at least one included cost is an estimate.
- `+` means additional requests are pending or have no dollar cost available.
- An entirely unpriced total says **Cost unknown**, not `$0.00`.
- Small nonzero costs display `<$0.01`; request details retain six decimal places.
- Storage/read failures remain visible so totals are not presented as complete.

## Coverage

| Request path | Usage and pricing |
| --- | --- |
| Pipeline chat and delegated task steps | AI SDK per-step tokens, including cache reads/writes. Gateway-reported `providerMetadata.gateway.cost` when present, otherwise a model list-rate estimate. |
| Screen observation / screen detective | Same accounting around the separate vision request. |
| Realtime voice | Every response is accounted before speech suppression, using original provider response usage. Text and audio have separate rates; cache modality details are required to price cached audio. |
| Realtime input transcription | Separate unpriced entry because the current gateway integration does not identify the billed transcription model/cost. |
| Cloud transcription | WAV chunk parsing for duration; published approximate OpenAI per-minute rates for recognized models. |
| ElevenLabs | Character count and response `character-cost` credits; dollars unavailable without plan/allowance reconciliation. |
| Tavily basic search | One request / one credit on success; dollars unavailable without plan/allowance reconciliation. |
| Apple model | No API charge. |
| Local wake/STT and system voice | No paid API requests; not recorded as individual zero-cost events. |
| External agents / integrations running their own work | Their downstream usage is not exposed by this ledger. Subscription/account usage remains separate. |

The history groups pipeline steps by one invocation and realtime responses by
one voice connection. It does not yet stitch separately requested transcription,
TTS and delegated invocations into a single end-to-end user-command bill.

Interrupted, failed or crashed requests without final usage are **unpriced**,
not assumed free. SDK-internal retries are included in the logical request;
unreported usage from failed attempts cannot be reconstructed. Provider invoices
can differ because of subscriptions, free credits, routing, long contexts,
service tiers, discounts, retries, taxes, or other apps using the same account.
Budget enforcement, account reconciliation and historical imports are not part
of this first version.

## Implementation

- `src/main/usage/ledger.ts`: append-only pending/final journal records, replay,
  deduplication, crash recovery, rollups and bounded history pages. Main process
  owns all writes. The renderer cannot insert charges or send prices.
- `src/main/usage/pricing.ts`: allowlisted numeric counters, token/audio pricing,
  gateway-reported cost parsing and WAV duration parsing.
- `src/main/usage/catalog.json`: standard pricing snapshot from the public
  [Gateway models API](https://ai-gateway.vercel.sh/v1/models), retrieved September
  8, 2026. Each priced record saves the actual rates and snapshot date used.
  Custom/unlisted models remain unpriced. Updating this snapshot affects future
  records only.
- GPT Realtime 2 cached audio uses the separately verified
  [OpenAI model rate](https://developers.openai.com/api/docs/models/gpt-realtime-2).
  Transcription estimates use [OpenAI pricing](https://developers.openai.com/api/docs/pricing).
- [ElevenLabs response metadata](https://elevenlabs.io/docs/api-reference/introduction/)
  and [Tavily search credits](https://docs.tavily.com/documentation/api-reference/endpoint/search)
  supply usage quantities, not invented subscription allocations.
- `usage:summary`, `usage:history`, `usage:changed`: typed preload bridge, shared
  across windows. Changes are coalesced for 250ms; idle views refresh every 30s
  for local date boundaries.

No prompts, transcripts, audio, screenshots, API keys or provider response bodies
are retained. Journal files are created with mode 0600 in a 0700 directory.
Totals currently replay the complete journal in memory; history responses are
limited to 100 requests. A future high-volume version should add indexed storage.

## Verification

- `pnpm exec tsx --test scripts/test-usage.ts`: pricing, cache/audio accounting,
  nonzero/unknown distinctions, persistence, duplicate completion, crash/torn-tail
  recovery, local date boundaries and concurrent group interruption.
- `pnpm build` then `node scripts/test-usage-desktop.mjs`: real Electron windows,
  built preload and renderer, isolated ledger; verifies empty → pending → priced
  updates, unpriced warnings, notch navigation and meter containment. Captures
  Settings/notch screenshots to a temporary directory. Uses synthetic billing
  fixtures, no credentials, network requests, mic or changes to user data.
- A live provider accounting check was attempted on September 8, 2026. The
  separate test process could not decrypt the app's OS-protected saved keys, so
  no live provider request was made. Invoice agreement remains unverified.
