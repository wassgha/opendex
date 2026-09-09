import { Minimize2, Mic, MicOff, Settings, SquarePen, WavesHorizontal, PanelsTopLeft } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { StatusPill } from "@/components/status-bar";
import { Button } from "@/components/ui/button";
import type { DexStatus } from "@/lib/dex/state";

export const ThemeFeedbackContext = createContext<ReactNode>(null);

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
  wakeWord = "Dex",
  showBrand = true,
  showStatus = true,
  isMuted,
  onToggleMute,
  onMinimize,
  onNewConversation,
}: {
  name?: string;
  wakeWord?: string;
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
  /** Start a fresh conversation (dismiss the current turn). Hidden when omitted. */
  onNewConversation?: () => void;
}) {
  const [widgetError, setWidgetError] = useState(false);
  const feedback = useContext(ThemeFeedbackContext);
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 sm:py-3">
      <div className="flex min-w-0 items-center gap-2.5">
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
      <div className="titlebar-no-drag pointer-events-auto relative z-40 flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Open floating widgets"
          title="Open floating widgets"
          className="rounded-full bg-dex-surface/70 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setWidgetError(false);
            window.opendex.openWidgets().catch(() => setWidgetError(true));
          }}
        >
          <PanelsTopLeft />
        </Button>
        {widgetError && <p role="alert" className="absolute right-0 top-full mt-12 w-56 rounded-md border border-border bg-background p-2 text-xs text-foreground">Could not open widgets. Try again from the tray menu.</p>}
        {showStatus && !feedback && (
          <StatusPill status={status} wakeWord={wakeWord} className="absolute right-0 top-full mt-2" />
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
        {onNewConversation && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onNewConversation}
            aria-label="New conversation"
            title="New conversation"
            className="rounded-full bg-dex-surface/70 text-muted-foreground backdrop-blur hover:text-foreground"
          >
            <SquarePen />
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
      {feedback && <div className="col-span-2 min-w-0 overflow-hidden">{feedback}</div>}
    </header>
  );
}
