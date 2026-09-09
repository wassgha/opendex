import { useEffect, useState } from "react";
import type { WidgetSlot, WidgetSlotPicker } from "../../../main/ipc/channels";
import { Button } from "@/components/ui/button";

export function WidgetSlotPickerApp() {
  const [data, setData] = useState<WidgetSlotPicker>();
  const [preview, setPreview] = useState<WidgetSlot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let changed = false;
    const off = window.opendexWidget.onSlotsChanged(state => { changed = true; setData(state); });
    window.opendexWidget.getSlots().then(state => { if (active && !changed) setData(state); })
      .catch(() => { if (active) setError("Could not load slots. Cancel and try again."); });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") window.opendexWidget.close(); };
    window.addEventListener("keydown", escape);
    return () => { active = false; off(); window.removeEventListener("keydown", escape); };
  }, []);
  const target = data?.slots.find(slot => slot.id === preview && !slot.occupied);
  return (
    <main aria-label="Choose a widget slot" className="relative flex flex-1 items-center justify-center bg-background/35 text-foreground"
      onClick={event => { if (event.target === event.currentTarget) window.opendexWidget.close(); }}>
      {target && <div aria-hidden="true" data-preview={target.id}
        className="pointer-events-none absolute border-2 border-primary bg-primary/15"
        style={{ left: target.x, top: target.y, width: target.width, height: target.height }} />}
      <div className="z-10 max-w-[min(360px,55vw)] rounded-xl border border-border bg-background p-5 text-center">
        <h1 className="text-lg font-medium">Dock {data?.title ?? "widget"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose a free slot on the screen edge. Hover or focus to preview its exact position.</p>
        <p role="status" className="mt-2 text-xs text-muted-foreground">{error || "Occupied slots cannot be shared."}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.opendexWidget.close()}>Cancel · Esc</Button>
      </div>
      {data?.slots.map(slot => {
        const top = slot.id.startsWith("top");
        const bottom = slot.id.startsWith("bottom");
        const left = slot.id.endsWith("left");
        const right = slot.id.endsWith("right");
        const width = Math.min(148, (data.width - 48) / 3);
        return <button key={slot.id} type="button" data-target={slot.id} disabled={slot.occupied}
          aria-label={`${slot.id.replaceAll("-", " ")}: ${slot.occupied ? "occupied" : slot.current ? "current slot" : "available"}`}
          onMouseEnter={() => setPreview(slot.id)} onMouseLeave={() => setPreview(null)}
          onFocus={() => setPreview(slot.id)} onBlur={() => setPreview(null)}
          onClick={() => window.opendexWidget.chooseSlot(slot.id).then(placed => {
            if (!placed) setError("That slot was just occupied. Choose another free slot.");
          }).catch(() => setError("Could not dock the widget. Cancel and try again."))}
          className="absolute z-20 min-h-14 rounded-lg border border-foreground/60 bg-background px-2 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-dashed disabled:border-muted-foreground/50 disabled:text-muted-foreground"
          style={{ width, left: left ? 12 : right ? data.width - width - 12 : (data.width - width) / 2,
            top: top ? 12 : bottom ? data.height - 72 : (data.height - 56) / 2 }}>
          {slot.id.charAt(0).toUpperCase() + slot.id.slice(1).replaceAll("-", " ")}
          <span className="mt-1 block text-xs font-normal normal-case">{slot.occupied ? "Occupied" : slot.current ? "Current slot" : "Available"}</span>
        </button>;
      })}
    </main>
  );
}
