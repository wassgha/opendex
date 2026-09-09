import { getToolView } from "./tool-registry";
import type { ToolInvocation, ToolSurface } from "./tool-view";
import { TOOLS as RESEARCH_TOOLS } from "./research/meta";

export function latestToolCard(invocations: ToolInvocation[]) {
  const carded = invocations.filter(inv => getToolView(inv.name).Card);
  const research = carded.findLast(inv => inv.name === RESEARCH_TOOLS.updateResearch && inv.status === "done");
  const stage = (research?.result as { stage?: string } | null)?.stage;
  // Search results must not displace the plan while an investigation is active.
  if (research && stage && !["complete", "blocked"].includes(stage)) return research;
  return carded.at(-1);
}

// Renders the *latest* tool result that has a Card in the registry (weather/
// clock/web-search today) — a single glanceable card, like Siri/Dynamic Island,
// rather than a growing stack. Label-only tools (computer/open) resolve to a
// view without a Card and are skipped (they surface as banners). Themes drop
// this into their conversation thread, choosing the surface.
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
  const latest = latestToolCard(invocations);
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
