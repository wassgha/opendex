import type { Rectangle } from "electron";
import type { WidgetEdges, WidgetSlot } from "../ipc/channels";

/** Logical pixels, consistent across display scale factors. */
export const MAGNET_DISTANCE = 24;
export const WIDGET_SLOTS: WidgetSlot[] = [
  "top-left", "top-center", "top-right", "middle-left",
  "middle-right", "bottom-left", "bottom-center", "bottom-right",
];
export const detached = (): WidgetEdges => ({ horizontal: null, vertical: null, slot: null, blockedSlot: null });

export function slotEdges(slot: WidgetSlot): WidgetEdges {
  return {
    horizontal: slot.endsWith("left") ? "left" : slot.endsWith("right") ? "right" : null,
    vertical: slot.startsWith("top") ? "top" : slot.startsWith("bottom") ? "bottom" : null,
    slot, blockedSlot: null,
  };
}

export function slotBounds(bounds: Rectangle, area: Rectangle, slot: WidgetSlot): Rectangle {
  const edges = slotEdges(slot);
  return {
    ...bounds,
    x: edges.horizontal === "left" ? area.x : edges.horizontal === "right" ? area.x + area.width - bounds.width
      : area.x + Math.round((area.width - bounds.width) / 2),
    y: edges.vertical === "top" ? area.y : edges.vertical === "bottom" ? area.y + area.height - bounds.height
      : area.y + Math.round((area.height - bounds.height) / 2),
  };
}

/** The edge capture band selects the nearest fixed slot, never an arbitrary offset. */
export function snapWidget(bounds: Rectangle, area: Rectangle): { bounds: Rectangle; edges: WidgetEdges } {
  const nearLeft = Math.abs(bounds.x - area.x) <= MAGNET_DISTANCE;
  const nearRight = Math.abs(bounds.x + bounds.width - area.x - area.width) <= MAGNET_DISTANCE;
  const nearTop = Math.abs(bounds.y - area.y) <= MAGNET_DISTANCE;
  const nearBottom = Math.abs(bounds.y + bounds.height - area.y - area.height) <= MAGNET_DISTANCE;
  const candidates = WIDGET_SLOTS.filter(slot => {
    const edge = slotEdges(slot);
    return (nearLeft && edge.horizontal === "left") || (nearRight && edge.horizontal === "right")
      || (nearTop && edge.vertical === "top") || (nearBottom && edge.vertical === "bottom");
  }).map(slot => ({ slot, target: slotBounds(bounds, area, slot) }));
  candidates.sort((a, b) =>
    Math.hypot(bounds.x - a.target.x, bounds.y - a.target.y) - Math.hypot(bounds.x - b.target.x, bounds.y - b.target.y));
  const nearest = candidates[0];
  return nearest ? { bounds: nearest.target, edges: slotEdges(nearest.slot) } : { bounds, edges: detached() };
}

function overlaps(a: Rectangle, b: Rectangle) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Main owns reservations synchronously: a claim is checked and committed together. */
export class SlotReservations<Owner> {
  private readonly claims = new Map<Owner, { displayId: number; slot: WidgetSlot; bounds: Rectangle }>();

  claim(owner: Owner, displayId: number, slot: WidgetSlot, bounds: Rectangle): boolean {
    if (!this.available(owner, displayId, slot, bounds)) return false;
    this.claims.set(owner, { displayId, slot, bounds });
    return true;
  }

  available(owner: Owner, displayId: number, slot: WidgetSlot, bounds: Rectangle): boolean {
    for (const [other, claim] of this.claims) {
      if (other !== owner && claim.displayId === displayId && (claim.slot === slot || overlaps(claim.bounds, bounds))) return false;
    }
    return true;
  }

  release(owner: Owner) { this.claims.delete(owner); }
}
