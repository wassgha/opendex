import { useEffect, useState } from "react";
import type { WidgetEdges } from "../../../main/ipc/channels";
import { GripHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const GOAL = 8;

/** Mounted only in a standalone window with the close/docking-only widget preload. */
export function FloatingWidgetApp() {
  const isGoal = new URLSearchParams(location.hash.split("?")[1]).get("id") === "goal";
  const [lightOn, setLightOn] = useState(false);
  const [count, setCount] = useState(0);
  const [dockError, setDockError] = useState(false);
  const [edges, setEdges] = useState<WidgetEdges>({ horizontal: null, vertical: null, slot: null, blockedSlot: null });
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.opendexWidget.onEdgesChanged(value => { changed = true; setEdges(value); });
    window.opendexWidget.getEdges().then(value => { if (active && !changed) setEdges(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  const docked = edges.slot?.replaceAll("-", " ");
  const title = isGoal ? "Goal counter" : "Preview light";
  const top = edges.vertical === "top";
  const bottom = edges.vertical === "bottom";
  const left = edges.horizontal === "left";
  const right = edges.horizontal === "right";

  return (
    <section aria-label={title} data-slot={edges.slot ?? "detached"}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground"
      style={{
        borderTopLeftRadius: top || left ? 0 : 16,
        borderTopRightRadius: top || right ? 0 : 16,
        borderBottomLeftRadius: bottom || left ? 0 : 16,
        borderBottomRightRadius: bottom || right ? 0 : 16,
        borderTopWidth: top ? 0 : 1,
        borderBottomWidth: bottom ? 0 : 1,
        borderLeftWidth: left ? 0 : 1,
        borderRightWidth: right ? 0 : 1,
      }}>
      <header className="titlebar-drag flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h1 className="flex items-center gap-2 text-sm font-medium"><GripHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />{title}</h1>
        <div className="titlebar-no-drag flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" aria-label="Choose docking slot" onClick={() => {
            setDockError(false);
            window.opendexWidget.showSlots().catch(() => setDockError(true));
          }}>Dock</Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Close ${title.toLowerCase()}`} title="Close widget (resets this example)" onClick={() => window.opendexWidget.close()}><X /></Button>
        </div>
      </header>
      <div className="titlebar-no-drag min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {isGoal ? (
          <>
            <p role="status" className="text-xs text-muted-foreground">{count === GOAL ? "Goal reached!" : `${count} of ${GOAL} steps complete`}</p>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="outline" size="icon-sm" aria-label="Remove one step" disabled={count === 0} onClick={() => setCount(value => Math.max(0, value - 1))}>−</Button>
              <output aria-label="Completed steps" className="w-8 text-center tabular-nums">{count}</output>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Add one step" disabled={count === GOAL} onClick={() => setCount(value => Math.min(GOAL, value + 1))}>+</Button>
              <Button type="button" variant="ghost" size="sm" disabled={count === 0} onClick={() => setCount(0)}>Reset</Button>
            </div>
            <progress aria-label="Goal progress" value={count} max={GOAL} className="mt-3 block h-2 w-full accent-primary" />
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="preview-light" className="flex items-center gap-2">
              <span aria-hidden="true" className={`size-3 rounded-full border ${lightOn ? "border-primary bg-primary" : "border-muted-foreground bg-background"}`} />
              <span aria-live="polite">Light {lightOn ? "on" : "off"}</span>
            </label>
            <Switch id="preview-light" checked={lightOn} onCheckedChange={setLightOn} aria-label="Preview light" />
          </div>
        )}
        <p role="status" className="mt-3 text-xs text-muted-foreground">{dockError ? "Could not show slots. Try Dock again." : edges.blockedSlot
          ? `${edges.blockedSlot.replaceAll("-", " ")} slot occupied · Try another slot`
          : docked ? `Clipped to ${docked} · Drag away to release`
            : "Click Dock to choose a visible slot"}</p>
      </div>
    </section>
  );
}
