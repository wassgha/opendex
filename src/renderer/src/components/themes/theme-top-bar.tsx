import { Minimize2, Mic, MicOff, Settings, WavesHorizontal } from "lucide-react";
import { StatusPill } from "@/components/status-bar";
import { Button } from "@/components/ui/button";
import type { DexStatus } from "@/lib/dex/state";

// Shared top bar used by every theme: brand on the left, and a single right-hand
// cluster holding the status pill, a standby (mic) toggle, and the settings gear.
// Grouping these here is what prevents them from colliding (they used to be
// rendered by separate owners in the same corner). The header itself is
// click-through so it never steals taps from the visualization underneath; only
// its controls catch pointer events.
export function ThemeTopBar({
  name,
  status,
  onOpenSettings,
  showBrand = true,
  showStatus = true,
  isMuted,
  onToggleMute,
  onMinimize,
}: {
  name?: string;
  status: DexStatus;
  onOpenSettings: () => void;
  showBrand?: boolean;
  showStatus?: boolean;
  /** Whether the wake-word loop is currently paused (standby). */
  isMuted?: boolean;
  /** Toggle standby (pause/resume listening). Hidden when omitted. */
  onToggleMute?: () => void;
  /** Collapse into the slim notch bar. Hidden when omitted. */
  onMinimize?: () => void;
}) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5">
      <div className="traffic-light-pad flex min-w-0 items-center gap-2.5">
        {showBrand && (
          <>
            <WavesHorizontal className="size-5 shrink-0 text-foreground" strokeWidth={2.4} />
            {name && (
              <span className="truncate text-xs uppercase tracking-[0.4em] text-muted-foreground">
                {name}
              </span>
            )}
          </>
        )}
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {showStatus && (
          <StatusPill status={status} className="hidden sm:inline-flex" />
        )}
        {onToggleMute && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? "Resume listening" : "Stand by (stop listening)"}
            title={
              isMuted
                ? "On standby — click to resume listening"
                : "Listening — click to stand by"
            }
            className="rounded-full bg-dex-surface/70 text-muted-foreground backdrop-blur hover:text-foreground"
          >
            {isMuted ? <MicOff /> : <Mic />}
          </Button>
        )}
        {onMinimize && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onMinimize}
            aria-label="Minimize to notch"
            title="Minimize to notch"
            className="rounded-full bg-dex-surface/70 text-muted-foreground backdrop-blur hover:text-foreground"
          >
            <Minimize2 />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="rounded-full bg-dex-surface/70 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <Settings />
        </Button>
      </div>
    </header>
  );
}
