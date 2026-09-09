import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export function TaskProgress({ progress }: { progress: { label: string; completed: number } | null }) {
  const [seconds, setSeconds] = useState(0);
  const active = progress !== null;
  useEffect(() => {
    setSeconds(0);
    if (!active) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active, progress?.label, progress?.completed]);
  if (!progress) return null;
  return <div className="flex h-10 w-full items-center gap-2 px-4 text-xs text-foreground/90" role="status" aria-live="polite">
    <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none text-primary" aria-hidden />
    <span className="min-w-0 flex-1 truncate">{progress.label === "Waiting for the task agent" && seconds >= 30 ? "Still waiting for the agent — no new action yet" : progress.label}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground" aria-live="off">{progress.completed > 0 ? `${progress.completed} done · ` : ""}{seconds}s</span>
  </div>;
}
