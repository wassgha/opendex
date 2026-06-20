import { Button, Key, Point, keyboard, mouse } from "@nut-tree-fork/nut-js";
import { systemPreferences } from "electron";
import { z } from "zod";
import { captureScreen, toScreenPoint, type Screenshot } from "./screen-capture";
import type { Skill, SkillTool, ToModelOutput } from "./types";

// nut.js defaults are slow & jittery; tighten them once on first use.
let configured = false;
function ensureConfigured() {
  if (configured) return;
  mouse.config.mouseSpeed = 3000; // px/sec when animating moves
  mouse.config.autoDelayMs = 25;
  keyboard.config.autoDelayMs = 4;
  configured = true;
}

// macOS gates mouse/keyboard injection behind Accessibility permission. If we
// call nut.js without it, the action silently no-ops (and libnut spams stderr),
// so the model would loop pointlessly. Preflight every input action: when the
// permission is missing, trigger the system grant dialog (which also registers
// the app in System Settings → Accessibility so the user can toggle it on) and
// return a clear, spoken-friendly error instead of acting.
let accessibilityPrompted = false;
function ensureInputAccess(): { ok: true } | { error: string } {
  if (process.platform !== "darwin") return { ok: true };
  if (systemPreferences.isTrustedAccessibilityClient(false)) return { ok: true };
  // Prompt once per run so we don't reopen the dialog on every retry.
  if (!accessibilityPrompted) {
    accessibilityPrompted = true;
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  return {
    error:
      "I don't have Accessibility permission, so I can't control the mouse or keyboard yet. I've opened the request — please enable OpenDex (in dev, the Electron app) under System Settings, Privacy and Security, Accessibility, then restart me and try again.",
  };
}

// The pixel space of the most recent screenshot, so the coordinates the model
// returns (in image space) can be mapped onto real display coordinates.
let lastShot: Screenshot | null = null;

// ── coordinate-bearing action results carry a fresh screenshot so the model can
//    see the effect of what it just did (the standard computer-use loop) ──────
type ActionResult =
  | { ok: true; message: string; shot?: Screenshot }
  | { error: string };

const withScreenshot: ToModelOutput = ({ output }) => {
  const o = output as ActionResult;
  if ("error" in o) return { type: "error-text", value: o.error };
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "media"; data: string; mediaType: string }
  > = [{ type: "text", text: o.message }];
  if (o.shot) parts.push({ type: "media", data: o.shot.base64, mediaType: o.shot.mediaType });
  return { type: "content", value: parts };
};

async function shoot(): Promise<Screenshot | null> {
  const shot = await captureScreen();
  if ("error" in shot) return null;
  lastShot = shot;
  return shot;
}

// Adaptive screenshot cadence: not every action needs a fresh screenshot.
// Keystroke-style actions (typeText, pressKeys) default to NOT capturing, so the
// model can chain a few related steps (type a field, Tab, type the next) without
// a round-trip per action. Clicks/scrolls capture by default since they change
// what's on screen. Either way the model can override via the `screenshot` arg.
async function finishAction(message: string, wantShot: boolean): Promise<ActionResult> {
  if (!wantShot) return { ok: true, message };
  const shot = await shoot();
  if (!shot) {
    return {
      ok: true,
      message: `${message} (couldn't capture a screenshot — check Screen Recording permission)`,
    };
  }
  return { ok: true, message, shot };
}

// Shared description for the per-action screenshot override.
const SHOT_ARG =
  "Whether to return a fresh screenshot so you can see the result. Omit to use the action's default; set false to chain another action without a screenshot, or true to force a look.";

/** Resolve a key name (case-insensitive) to a nut.js Key. */
function keyFromToken(token: string): Key | null {
  const t = token.trim().toLowerCase();
  const map: Record<string, Key> = {
    enter: Key.Enter,
    return: Key.Enter,
    tab: Key.Tab,
    esc: Key.Escape,
    escape: Key.Escape,
    space: Key.Space,
    spacebar: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete,
    del: Key.Delete,
    up: Key.Up,
    arrowup: Key.Up,
    down: Key.Down,
    arrowdown: Key.Down,
    left: Key.Left,
    arrowleft: Key.Left,
    right: Key.Right,
    arrowright: Key.Right,
    home: Key.Home,
    end: Key.End,
    pageup: Key.PageUp,
    pgup: Key.PageUp,
    pagedown: Key.PageDown,
    pgdn: Key.PageDown,
    cmd: Key.LeftCmd,
    command: Key.LeftCmd,
    meta: Key.LeftSuper,
    win: Key.LeftSuper,
    windows: Key.LeftSuper,
    super: Key.LeftSuper,
    ctrl: Key.LeftControl,
    control: Key.LeftControl,
    alt: Key.LeftAlt,
    option: Key.LeftAlt,
    opt: Key.LeftAlt,
    shift: Key.LeftShift,
  };
  if (t in map) return map[t];
  // Letters a–z, digits 0–9, function keys f1–f12.
  if (/^[a-z]$/.test(t)) return Key[t.toUpperCase() as keyof typeof Key] as Key;
  if (/^[0-9]$/.test(t)) return Key[`Num${t}` as keyof typeof Key] as Key;
  if (/^f([1-9]|1[0-2])$/.test(t)) return Key[`F${t.slice(1)}` as keyof typeof Key] as Key;
  return null;
}

const tools: SkillTool[] = [
  {
    name: "captureScreen",
    description:
      "Take a screenshot of the screen and look at it. Coordinates in the returned image are what you pass to moveMouse/click. Use this first to see what's on screen.",
    inputSchema: z.object({}),
    summarize: () => "Take a screenshot of the screen",
    toModelOutput: withScreenshot,
    execute: async (): Promise<ActionResult> => {
      const shot = await captureScreen();
      if ("error" in shot) return { error: shot.error };
      lastShot = shot;
      return {
        ok: true,
        message: `Screenshot taken (${shot.width}×${shot.height}). Coordinates are in this image's pixel space; (0,0) is top-left.`,
        shot,
      };
    },
  },
  {
    name: "click",
    description:
      "Click the mouse at a point (in screenshot pixel coordinates). Optionally double-click or use the right/middle button. Returns a fresh screenshot by default.",
    inputSchema: z.object({
      x: z.number().describe("X coordinate in the most recent screenshot's pixel space."),
      y: z.number().describe("Y coordinate in the most recent screenshot's pixel space."),
      button: z.enum(["left", "right", "middle"]).optional().describe("Defaults to left."),
      double: z.boolean().optional().describe("Double-click when true."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const { x, y, button, double } = i as { x: number; y: number; button?: string; double?: boolean };
      return `${double ? "Double-" : ""}${button ?? "left"}-click at (${x}, ${y})`;
    },
    toModelOutput: withScreenshot,
    execute: async ({
      x,
      y,
      button,
      double,
      screenshot,
    }: {
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
      double?: boolean;
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const ref = lastShot;
      const p = ref ? toScreenPoint(x, y, ref) : { x, y };
      await mouse.setPosition(new Point(p.x, p.y));
      const btn = button === "right" ? Button.RIGHT : button === "middle" ? Button.MIDDLE : Button.LEFT;
      if (double) await mouse.doubleClick(btn);
      else await mouse.click(btn);
      return finishAction(`Clicked at (${x}, ${y}).`, screenshot ?? true);
    },
  },
  {
    name: "moveMouse",
    description: "Move the mouse pointer to a point (screenshot pixel coordinates) without clicking.",
    inputSchema: z.object({
      x: z.number(),
      y: z.number(),
    }),
    summarize: (i) => {
      const { x, y } = i as { x: number; y: number };
      return `Move mouse to (${x}, ${y})`;
    },
    execute: async ({ x, y }: { x: number; y: number }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const ref = lastShot;
      const p = ref ? toScreenPoint(x, y, ref) : { x, y };
      await mouse.setPosition(new Point(p.x, p.y));
      return { ok: true, message: `Moved mouse to (${x}, ${y}).` };
    },
  },
  {
    name: "typeText",
    description:
      "Type a string of text at the current focus (as if typed on the keyboard). Does not press Enter unless the text contains a newline. By default returns NO screenshot, so you can chain typing/keys; pass screenshot:true when you want to see the result.",
    inputSchema: z.object({
      text: z.string().describe("The literal text to type."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const t = (i as { text: string }).text;
      return `Type: "${t.length > 60 ? t.slice(0, 57) + "…" : t}"`;
    },
    toModelOutput: withScreenshot,
    execute: async ({ text, screenshot }: { text: string; screenshot?: boolean }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      await keyboard.type(text);
      return finishAction(`Typed ${text.length} character(s).`, screenshot ?? false);
    },
  },
  {
    name: "pressKeys",
    description:
      "Press a key or keyboard shortcut. Pass the keys of a chord together, e.g. ['cmd','c'] to copy, ['ctrl','shift','t'], or ['enter']. Modifiers: cmd, ctrl, alt/option, shift, meta/super. Use the platform-appropriate modifier. By default returns NO screenshot, so you can chain keys/typing; pass screenshot:true when you want to see the result (e.g. after Enter submits something).",
    inputSchema: z.object({
      keys: z.array(z.string()).min(1).describe("Keys pressed together as one chord."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => `Press ${(i as { keys: string[] }).keys.join(" + ")}`,
    toModelOutput: withScreenshot,
    execute: async ({ keys, screenshot }: { keys: string[]; screenshot?: boolean }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const resolved = keys.map(keyFromToken);
      const bad = keys.find((_, idx) => resolved[idx] === null);
      if (bad) return { error: `Unrecognised key: "${bad}".` };
      const ks = resolved as Key[];
      await keyboard.pressKey(...ks);
      await keyboard.releaseKey(...[...ks].reverse());
      return finishAction(`Pressed ${keys.join(" + ")}.`, screenshot ?? false);
    },
  },
  {
    name: "scroll",
    description:
      "Scroll the screen in a direction by an amount (in scroll steps). Returns a fresh screenshot by default.",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().min(1).max(50).optional().describe("Scroll steps (default 5)."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const { direction, amount } = i as { direction: string; amount?: number };
      return `Scroll ${direction} by ${amount ?? 5}`;
    },
    toModelOutput: withScreenshot,
    execute: async ({
      direction,
      amount,
      screenshot,
    }: {
      direction: "up" | "down" | "left" | "right";
      amount?: number;
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const n = amount ?? 5;
      if (direction === "up") await mouse.scrollUp(n);
      else if (direction === "down") await mouse.scrollDown(n);
      else if (direction === "left") await mouse.scrollLeft(n);
      else await mouse.scrollRight(n);
      return finishAction(`Scrolled ${direction}.`, screenshot ?? true);
    },
  },
];

export const computerSkill: Skill = {
  id: "computer",
  label: "Control the computer",
  description:
    "See the screen and control the mouse & keyboard to operate apps on your behalf. Powerful — keep this gated.",
  sensitive: true,
  optIn: true,
  tools,
};
