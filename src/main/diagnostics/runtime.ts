import type { SessionState } from "../ipc/channels";
import type { PublicConfig } from "../config/schema";
import { LLM_PROVIDERS } from "../config/llm-providers";
// Keep the report in the loaded main bundle. A running development process
// must not depend on a hashed lazy chunk that the next build removes.
import { readDiagnosticReport } from "./report";

let snapshot: { status: string; muted: boolean; activityCount: number; observedAt: number } | null = null;
const statuses = new Set(["idle", "listening_wake", "active_listening", "follow_up_listening", "thinking", "speaking", "muted", "error", "unsupported"]);

export function observeDiagnosticSession(state: SessionState, now = Date.now()) {
  snapshot = { status: statuses.has(state.status) ? state.status : "unknown", muted: state.muted === true,
    activityCount: Array.isArray(state.activity) ? state.activity.length : 0, observedAt: now };
}

export function diagnosticRuntime(config: PublicConfig, now = Date.now()) {
  const { config: cfg, secrets } = config;
  const provider = LLM_PROVIDERS.find(p => p.id === cfg.llm.provider);
  const checks: { id: string; state: "ready" | "missing" | "unsupported" | "unknown"; detail: string }[] = [];
  const credential = (id: string, present: boolean) => checks.push({ id, state: present ? "ready" : "missing",
    detail: present ? "A credential is present; validity and service connectivity are untested." : "No credential is configured." });
  if (cfg.voice.mode === "realtime") {
    if (cfg.realtime.provider === "gateway") credential("realtime-credential", secrets.AI_GATEWAY_API_KEY);
    else if (cfg.realtime.provider === "openai") credential("realtime-credential", secrets.OPENAI_API_KEY);
    else checks.push({ id: "realtime-provider", state: "unsupported", detail: "This realtime provider is not supported." });
  } else {
    if (cfg.tts.engine === "elevenlabs") credential("speech-output-credential", secrets.ELEVENLABS_API_KEY);
    if (cfg.voiceInput.sttProvider === "openai") credential("transcription-credential", secrets.OPENAI_API_KEY);
  }
  // Pipeline LLM also handles delegated tasks in realtime mode.
  if (provider?.secretName) credential("language-model-credential", secrets[provider.secretName]);
  else checks.push({ id: "language-model", state: provider?.comingSoon || !provider ? "unsupported" : "unknown",
    detail: provider?.comingSoon || !provider ? "The selected language model provider is unavailable." : "On-device model readiness has not been probed." });
  return {
    mode: cfg.voice.mode,
    session: snapshot ? { ...snapshot, ageMs: Math.max(0, now - snapshot.observedAt) } : null,
    checks,
    limitations: ["Session state is the latest renderer observation, not a heartbeat or proof the microphone is live.",
      "No network requests, audio capture, model loads, or recovery actions were performed.",
      "Credential presence does not establish authentication, quota, or provider availability."],
  };
}

export async function inspectDex(last = 1) {
  const [{ app, systemPreferences }, { getPublicConfig }, { join }] = await Promise.all([
    import("electron"), import("../config/store"), import("node:path"),
  ]);
  const permissions = process.platform === "darwin" ? {
    microphone: systemPreferences.getMediaAccessStatus("microphone"),
    screen: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "not-granted",
  } : { microphone: "unknown", screen: "unknown", accessibility: "unknown" };
  return {
    app: { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, uptimeSeconds: Math.floor(process.uptime()) },
    runtime: diagnosticRuntime(getPublicConfig()), permissions,
    permissionInterpretation: "OS not-determined/unknown is inconclusive, not a denial or proof of failed capture. Successful voice input and user corrections take precedence over a speculative permission diagnosis.",
    history: await readDiagnosticReport(join(app.getPath("userData"), "diagnostics"), last, Date.now(), { excludeDiagnosticSessions: true, wakeWord: getPublicConfig().config.assistant.wakeWord }),
  };
}
