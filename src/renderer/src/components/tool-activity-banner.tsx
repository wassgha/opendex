import type { ToolActivity } from "@/lib/dex/use-dex";

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
          className="flex animate-dex-rise items-center gap-2.5 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-sm text-white/85 shadow-lg backdrop-blur"
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
