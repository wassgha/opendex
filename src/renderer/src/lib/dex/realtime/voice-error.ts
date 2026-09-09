export function isVoiceFailureFeedback(message = ""): boolean {
  return /^(Voice (credits exhausted|authentication failed|rate limit reached|connection failed|reply timed out)|Audio unavailable)/.test(message);
}

/** Bounded UI copy: provider errors can contain request details, so never echo
 * arbitrary server text into the compact status surface. */
export function voiceErrorFeedback(message: string, wakeWord: string): string {
  if (/no credits remaining|insufficient_quota|exceeded your current quota|credit balance|billing hard limit/i.test(message)) {
    return "Voice credits exhausted · add provider credits or change provider in Settings";
  }
  if (/invalid.{0,20}(api.?key|authentication)|incorrect api key|unauthorized|authentication failed/i.test(message)) {
    return "Voice authentication failed · check your provider API key in Settings";
  }
  if (/rate.?limit|too many requests/i.test(message)) {
    return `Voice rate limit reached · wait briefly, then say ${wakeWord} to retry`;
  }
  const reason = message === "Voice reply timed out" ? message : "Voice connection failed";
  return `${reason} · say ${wakeWord} to retry`;
}
