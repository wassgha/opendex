import { useState } from "react";
import { CheckCircle2, ExternalLink, Monitor, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { useScreenHealth } from "@/lib/use-screen-health";
import { SCREEN_RECOVERY, screenBillingUrl } from "../../../main/config/screen-health";
import { LLM_PROVIDERS } from "../../../main/config/llm-providers";

export function ScreenAccessPanel({ onlyError = false }: { onlyError?: boolean }) {
  const health = useScreenHealth();
  const [actionError, setActionError] = useState("");
  const [opening, setOpening] = useState(false);
  if (!health || (onlyError && health.state !== "error" && health.state !== "checking")) return null;
  const busy = health.state === "checking";
  const recovery = health.issue ? SCREEN_RECOVERY[health.issue] : null;
  const provider = LLM_PROVIDERS.find((p) => p.id === health.provider)?.label ?? "Vision provider";
  const title = busy ? "Checking screen access…" : recovery?.title ?? (health.state === "ready" ? "Dex can read your screen" : "Screen access");
  const fix = async (action: "billing" | "permission" | "model") => {
    setActionError(""); setOpening(true);
    try { await window.opendex.fixScreen(action); }
    catch { setActionError("Couldn't open that page. You can also check Language model in Settings."); }
    finally { setOpening(false); }
  };
  const retry = async () => {
    setActionError("");
    try { await window.opendex.retryScreen(); }
    catch { setActionError("Couldn't run the check. Make sure Control the computer is enabled in Skills & tools."); }
  };
  const Icon = busy ? Monitor : health.state === "ready" ? CheckCircle2 : recovery ? TriangleAlert : Monitor;
  return (
    <section aria-label="Screen access" className="titlebar-no-drag w-full rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug">{title}</h3>
            <p className="mt-1 break-words text-xs text-muted-foreground">{provider} · {health.model}</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {busy ? "Capturing one screenshot and asking your vision provider to describe it." : recovery?.explanation ?? (health.state === "ready" ? "The last screenshot was captured and described successfully. A new snapshot is taken on your next wake-up." : "Check whether Dex can capture and understand your screen. This sends one screenshot to your selected vision provider.")}
        </p>
      </div>
      {recovery && !busy && (
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {recovery.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {health.issue === "quota" && screenBillingUrl(health.provider) && (
          <Button disabled={opening || busy} onClick={() => void fix("billing")}><ExternalLink />Open billing</Button>
        )}
        {health.issue === "permission" && (
          <Button disabled={opening || busy} onClick={() => void fix("permission")}><ExternalLink />Screen Recording settings</Button>
        )}
        <Button variant={recovery ? "outline" : "default"} disabled={busy} onClick={() => void retry()}>
          <RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
          {busy ? "Checking…" : health.state === "idle" ? "Check screen access" : "Try again"}
        </Button>
        <Button variant="ghost" disabled={opening || busy} onClick={() => void fix("model")}>Change model</Button>
      </div>
      {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}
    </section>
  );
}

export function ScreenIssueLink() {
  const health = useScreenHealth();
  if (health?.state !== "error") return null;
  return <button type="button" onClick={() => void window.opendex.openSettings("screen")} className="titlebar-no-drag flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><TriangleAlert className="size-3.5" aria-hidden />Screen access needs attention<span className="underline">Fix</span></button>;
}
