import { Settings } from "lucide-react";
import { StatusPill } from "@/components/status-bar";
import { Button } from "@/components/ui/button";
import type { DexStatus } from "@/lib/dex/state";

// Shared top bar used by every theme: brand on the left, and a single right-hand
// cluster holding the status pill + the settings gear. Grouping status and the
// gear here is what prevents them from colliding (they used to be rendered by two
// different owners in the same corner). The header itself is click-through so it
// never steals taps from the visualization underneath; only its controls catch
// pointer events.
export function ThemeTopBar({
  name,
  status,
  onOpenSettings,
  showBrand = true,
  showStatus = true,
}: {
  name?: string;
  status: DexStatus;
  onOpenSettings: () => void;
  showBrand?: boolean;
  showStatus?: boolean;
}) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5">
      <div className="min-w-0">
        {showBrand && (
          <div className="truncate text-xs uppercase tracking-[0.4em] text-muted-foreground">
            {name || "OpenDex"}
          </div>
        )}
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {showStatus && (
          <StatusPill status={status} className="hidden sm:inline-flex" />
        )}
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="rounded-full bg-card/50 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <Settings />
        </Button>
      </div>
    </header>
  );
}
