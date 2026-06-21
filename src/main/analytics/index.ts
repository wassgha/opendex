// Anonymous usage analytics via the GA4 Measurement Protocol.
//
// Privacy contract: we NEVER send voice audio, transcripts, prompts, model
// replies, API keys, opened URLs, or file paths. Only coarse, non-identifying
// signals (app version, OS, and which features/config options are in use) tied
// to a random, locally-generated client id. The whole thing is gated on
// `config.analytics.enabled` (opt-out) and is fire-and-forget — it must never
// block, throw, or slow down the app.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { getConfig } from "../config/store";

// Don't pollute production data with developer runs. Set GA_DEBUG=1 to send
// from a `pnpm dev` session when you actually want to test the pipeline.
const devSkip = (): boolean => !app.isPackaged && process.env.GA_DEBUG !== "1";

// GA4 credentials. The measurement id is public (it ships in every gtag web
// page); the api secret only authorizes sending events to this property. Both
// are safe to bundle in a client. Env vars win so dev can point at a test
// property without editing source.
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID ?? "G-HBB5QNHS90";
const GA_API_SECRET = process.env.GA_API_SECRET ?? "ShIZno_5RQavnZFZ6UjU_w";

const ENDPOINT = "https://www.google-analytics.com/mp/collect";

let clientId = "";
let sessionId = "";

/** A stable, anonymous id persisted in userData (not tied to any account/PII). */
function loadClientId(): string {
  const file = join(app.getPath("userData"), "analytics-client-id");
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
  } catch {
    // fall through and regenerate
  }
  const id = randomUUID();
  try {
    writeFileSync(file, id, "utf8");
  } catch {
    // best effort — a non-persisted id still works for this session
  }
  return id;
}

export function initAnalytics(): void {
  clientId = loadClientId();
  sessionId = String(Date.now());
}

/** Inert until real GA4 credentials are configured (placeholder → no sends). */
function credsConfigured(): boolean {
  return (
    GA_MEASUREMENT_ID.startsWith("G-") &&
    GA_MEASUREMENT_ID !== "G-XXXXXXXXXX" &&
    GA_API_SECRET.length > 0
  );
}

function analyticsEnabled(): boolean {
  try {
    return getConfig().analytics.enabled;
  } catch {
    return false;
  }
}

/** Non-PII params attached to every event. */
function baseParams(): Record<string, string | number> {
  return {
    app_version: app.getVersion(),
    os: process.platform,
    arch: process.arch,
    // GA4 needs these for the event to count toward sessions/engagement.
    session_id: sessionId,
    engagement_time_msec: 100,
  };
}

/**
 * Send one anonymous event. No-op when disabled, unconfigured, or pre-init.
 * Fire-and-forget: failures are swallowed so analytics can never affect the app.
 */
export function track(
  name: string,
  params: Record<string, string | number | boolean> = {},
): void {
  if (devSkip() || !clientId || !credsConfigured() || !analyticsEnabled()) return;
  const url = `${ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;
  const body = JSON.stringify({
    client_id: clientId,
    events: [{ name, params: { ...baseParams(), ...params } }],
  });
  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {});
  } catch {
    // never throw from a tracking call
  }
}
