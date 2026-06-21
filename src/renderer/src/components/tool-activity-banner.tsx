import type { ToolActivity } from "@/lib/dex/use-dex";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const STOP_HINT = IS_MAC ? "⌘⎋" : "Ctrl+Esc";

// Always-available emergency stop, shown whenever the agent is busy. The global
// ⌘/Ctrl+Esc hotkey does the same thing and works even when another app has
// focus (during computer-use OpenDex isn't the focused window) — this button is
// the visible reminder + a fallback for when OpenDex is in front.
export function StopControl({ onStop }: { onStop: () => void }) {
  return (
    <div className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={onStop}
        title="Stop the assistant"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/15 px-4 py-1.5 text-sm font-medium text-destructive-foreground shadow-lg backdrop-blur transition hover:bg-destructive/25"
      >
        <span className="h-2.5 w-2.5 rounded-[2px] bg-destructive" aria-hidden />
        Stop
        <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-normal text-destructive-foreground/70">
          {STOP_HINT}
        </kbd>
      </button>
    </div>
  );
}

// A stack of transient banners showing what the agent is doing (tool calls),
// rendered as global chrome over whichever theme is active. Newest at the
// bottom; each entry self-expires from the hook's state.
export function ToolActivityBanner({ activity }: { activity: ToolActivity[] }) {
  if (activity.length === 0) return null;
  // Show only the most recent few so a long computer-use run doesn't fill the screen.
  const visible = activity.slice(-4);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex flex-col items-center gap-2 px-4">
      {visible.map((t) => (
        <div
          key={t.id}
          className="flex animate-dex-rise items-center gap-2.5 rounded-full border border-border bg-dex-surface/85 px-4 py-2 text-sm text-foreground/85 shadow-lg backdrop-blur"
        >
          <span aria-hidden className="text-base leading-none">
            {t.icon}
          </span>
          <span className="font-medium">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
