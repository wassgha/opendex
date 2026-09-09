import { test } from "node:test";
import assert from "node:assert/strict";
import { snapWidget, slotBounds, SlotReservations, WIDGET_SLOTS } from "../src/main/widgets/magnet";

const area = { x: -1440, y: 0, width: 1440, height: 900 };
const size = { width: 300, height: 220 };
const bounds = { ...size, x: -800, y: 250 };

test("exactly eight fixed slots with distinct positions on a normal display", () => {
  assert.equal(WIDGET_SLOTS.length, 8);
  assert.equal(new Set(WIDGET_SLOTS.map(slot => JSON.stringify(slotBounds(bounds, area, slot)))).size, 8);
  for (const slot of WIDGET_SLOTS) {
    const target = slotBounds(bounds, area, slot);
    assert.equal(snapWidget(target, area).edges.slot, slot);
  }
});

test("edge movement quantizes to an edge center or corner rather than a free offset", () => {
  const result = snapWidget({ ...bounds, x: area.x + 10, y: 380 }, area);
  assert.equal(result.edges.slot, "middle-left");
  assert.deepEqual(result.bounds, { ...size, x: -1440, y: 340 });
  assert.equal(snapWidget({ ...bounds, x: area.x + 10, y: 50 }, area).edges.slot, "top-left");
});

test("overshoot snaps; leaving the capture band releases", () => {
  assert.equal(snapWidget({ ...bounds, x: -290, y: 695 }, area).edges.slot, "bottom-right");
  const free = { ...bounds, x: area.x + 25, y: 250 };
  assert.equal(snapWidget(free, area).edges.slot, null);
  assert.deepEqual(snapWidget(free, area).bounds, free);
});

test("slot coordinates follow physical display bounds including negative origins", () => {
  assert.deepEqual(slotBounds(bounds, { x: 0, y: -1080, width: 1920, height: 1080 }, "bottom-right"),
    { ...size, x: 1620, y: -220 });
});

test("one owner per slot, rejection preserves old claim, release frees it", () => {
  const slots = new SlotReservations<string>();
  const left = slotBounds(bounds, area, "top-left");
  const right = slotBounds(bounds, area, "top-right");
  assert.ok(slots.claim("light", 1, "top-left", left));
  assert.ok(slots.claim("goal", 1, "top-right", right));
  assert.equal(slots.claim("goal", 1, "top-left", left), false);
  assert.equal(slots.claim("third", 1, "top-right", right), false);
  assert.ok(slots.claim("light", 1, "top-left", left));
  slots.release("light");
  assert.ok(slots.claim("goal", 1, "top-left", left));
  assert.ok(slots.claim("third", 1, "top-right", right));
});

test("reservations are per display and guard overlapping adjacent slots on small displays", () => {
  const slots = new SlotReservations<string>();
  const small = { x: 0, y: 0, width: 360, height: 420 };
  assert.ok(slots.claim("light", 1, "top-left", slotBounds(bounds, small, "top-left")));
  assert.ok(slots.claim("goal", 2, "top-left", slotBounds(bounds, small, "top-left")));
  assert.equal(slots.claim("other", 1, "top-center", slotBounds(bounds, small, "top-center")), false);
});
