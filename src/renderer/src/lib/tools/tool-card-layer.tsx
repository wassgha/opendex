import type { ToolInvocation } from "@/lib/dex/use-dex";
import { getToolView } from "./index";
import type { ToolSurface } from "./types";

// Renders the *latest* tool result that has a Card in the registry (weather/
// clock/web-search today) — a single glanceable card, like Siri/Dynamic Island,
// rather than a growing stack. Label-only tools (computer/open) resolve to a
// view without a Card and are skipped (they surface as banners). Themes drop
// this where they want the card to appear, choosing the surface.
export function ToolCardLayer({
  invocations,
  surface,
  className,
}: {
  invocations: ToolInvocation[];
  surface: ToolSurface;
  /** Wrapper class (alignment/width). Nothing renders when there's no card, so
   *  this never leaves an empty element behind in a flex/gap layout. */
  className?: string;
}) {
  const carded = invocations.filter((inv) => getToolView(inv.name).Card);
  const latest = carded[carded.length - 1];
  if (!latest) return null;

  const Card = getToolView(latest.name).Card!;
  return (
    <div className={className}>
      <Card
        name={latest.name}
        input={latest.input}
        result={latest.result}
        status={latest.status}
        surface={surface}
      />
    </div>
  );
}
