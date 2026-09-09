import type { LlmProvider } from "./schema";

export type ScreenIssue = "quota" | "permission" | "authentication" | "rate_limit" | "unsupported" | "connection" | "unknown";
export interface ScreenHealth {
  state: "idle" | "checking" | "ready" | "error";
  issue?: ScreenIssue;
  provider: LlmProvider;
  model: string;
  checkedAt?: string;
}

export function screenIssueForError(error: unknown): ScreenIssue {
  const e = error as { responseBody?: string; statusCode?: number; message?: string; name?: string } | null;
  let code: unknown;
  try { code = JSON.parse(e?.responseBody || "{}").error?.code; } catch { /* No raw error text reaches the UI. */ }
  if (code === "credit_balance_exhausted" || code === "insufficient_quota") return "quota";
  if (e?.statusCode === 401 || e?.statusCode === 403 || /no .*api key is set/i.test(e?.message || "")) return "authentication";
  if (e?.statusCode === 429) return "rate_limit";
  if (e?.statusCode === 400 || e?.statusCode === 404) return "unsupported";
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || /fetch|network|connection/i.test(e?.message || "")) return "connection";
  return "unknown";
}

export function screenBillingUrl(provider: LlmProvider): string | null {
  return provider === "openai" ? "https://platform.openai.com/settings/organization/billing/overview" : null;
}

export const SCREEN_RECOVERY: Record<ScreenIssue, { title: string; explanation: string; steps: string[] }> = {
  quota: { title: "Screen understanding needs API credits", explanation: "Dex captured the screen, but the vision provider rejected the request because its API credits or quota are exhausted.", steps: ["Check the API account's balance and spending limits.", "Add credits or choose another funded vision provider in Language model.", "Return here and try again."] },
  permission: { title: "Allow Dex to see your screen", explanation: "macOS is blocking screen capture. Your microphone permission does not include screen access.", steps: ["Open Screen Recording settings.", "Enable Electron for this source version of Dex.", "Quit and relaunch Dex, then try again."] },
  authentication: { title: "Check the vision API key", explanation: "The selected vision provider could not authenticate this request.", steps: ["Open Language model and check the selected provider and API key.", "Use a valid key with access to the selected model, then try again."] },
  rate_limit: { title: "The vision provider is busy", explanation: "The provider is temporarily limiting requests. This does not mean your credits are exhausted.", steps: ["Wait a moment before trying again.", "If this continues, check the API account's rate limits or choose another model."] },
  unsupported: { title: "Check the selected vision model", explanation: "The provider rejected the model or screenshot request.", steps: ["Open Language model and select a model that accepts images and is available to your API key.", "Return here and try again."] },
  connection: { title: "Couldn't reach the vision provider", explanation: "The request could not finish because of a connection problem or timeout.", steps: ["Check your internet connection and try again.", "If this continues, check your provider's service status."] },
  unknown: { title: "Dex couldn't read the screen", explanation: "Screen capture or image analysis failed. Dex has no reliable screen description for this request.", steps: ["Try again to check screen access and the vision provider.", "If this continues, check the model and API key in Language model."] },
};
