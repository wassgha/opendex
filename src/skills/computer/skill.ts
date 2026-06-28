import {
  Button,
  Key,
  Point,
  keyboard,
  mouse,
  straightTo,
} from "@nut-tree-fork/nut-js";
import { clipboard, systemPreferences } from "electron";
import { z } from "zod";
import { getConfig } from "../../main/config/store";
import {
  captureScreen,
  captureStable,
  framesDiffer,
  toScreenPoint,
  type Screenshot,
} from "./screen-capture";
import { meta, TOOLS } from "./meta";
import type { Skill, SkillTool, ToModelOutput } from "../types";

// nut.js defaults are slow & jittery; tighten them once on first use.
let configured = false;
function ensureConfigured() {
  if (configured) return;
  mouse.config.mouseSpeed = 3000; // px/sec when animating moves
  mouse.config.autoDelayMs = 25;
  keyboard.config.autoDelayMs = 4;
  configured = true;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

// The most recent screenshot, so the coordinates the model returns (in image
// space) can be mapped onto real display coordinates, and zoom regions can be
// resolved relative to it.
let lastShot: Screenshot | null = null;
// Fingerprint of the last frame we actually sent to the model, so we can tell it
// "no visible change" (and skip a redundant near-identical image) when an action
// didn't alter the screen.
let lastSentSig: Uint8Array | null = null;

/** Move the cursor to a screenshot-space point, animating per config. */
async function moveTo(x: number, y: number): Promise<void> {
  const ref = lastShot;
  const p = ref ? toScreenPoint(x, y, ref) : { x, y };
  const animate = getConfig().computer?.animateCursor ?? true;
  if (animate) await mouse.move(straightTo(new Point(p.x, p.y)));
  else await mouse.setPosition(new Point(p.x, p.y));
}

/** Paste text via the clipboard (instant, avoids autocomplete corruption),
 *  restoring whatever was on the clipboard before. */
async function pasteText(text: string): Promise<void> {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  const mod = process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl;
  await keyboard.pressKey(mod, Key.V);
  await keyboard.releaseKey(Key.V, mod);
  // Let the paste consume our text before we put the old clipboard back.
  await delay(120);
  clipboard.writeText(prev);
}

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

/** Capture a settled frame and remember it for coordinate mapping. */
async function shoot(): Promise<Screenshot | null> {
  const shot = await captureStable();
  if ("error" in shot) return null;
  lastShot = shot;
  return shot;
}

// Adaptive screenshot cadence: not every action needs a fresh screenshot.
// Keystroke-style actions (typeText, pressKeys) default to NOT capturing, so the
// model can chain a few related steps (type a field, Tab, type the next) without
// a round-trip per action. Clicks/scrolls capture by default since they change
// what's on screen. Either way the model can override via the `screenshot` arg.
//
// When we do capture, we settle the frame first (so we never act on a half-loaded
// screen) and diff it against the last frame the model saw: if nothing changed we
// return a short text note instead of a near-identical image — cheaper, and a
// useful signal that a click likely missed.
async function finishAction(message: string, wantShot: boolean): Promise<ActionResult> {
  if (!wantShot) return { ok: true, message };
  const shot = await shoot();
  if (!shot) {
    return {
      ok: true,
      message: `${message} (couldn't capture a screenshot — check Screen Recording permission)`,
    };
  }
  if (lastSentSig && !framesDiffer(lastSentSig, shot.signature)) {
    return { ok: true, message: `${message} (no visible change on screen)` };
  }
  lastSentSig = shot.signature;
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

function buttonOf(button?: "left" | "right" | "middle"): Button {
  return button === "right" ? Button.RIGHT : button === "middle" ? Button.MIDDLE : Button.LEFT;
}

const tools: SkillTool[] = [
  {
    name: TOOLS.captureScreen,
    description:
      "Take a screenshot and look at it. Coordinates in the returned image are what you pass to moveMouse/click/drag. Use this first to see what's on screen. To read or precisely click something small, pass a `region` to zoom in — it renders that area at full detail (coordinates then refer to the zoomed image). Pass `displayId` to look at another monitor.",
    inputSchema: z.object({
      region: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .optional()
        .describe(
          "Zoom into this rectangle of the most recent screenshot (its pixel space). Renders that area at higher detail; returned coordinates are in the zoomed image.",
        ),
      displayId: z
        .number()
        .optional()
        .describe("Capture a specific display. Omit to use the display under the cursor."),
    }),
    summarize: (i) => ((i as { region?: unknown }).region ? "Zoom into a region of the screen" : "Take a screenshot of the screen"),
    toModelOutput: withScreenshot,
    execute: async ({
      region,
      displayId,
    }: {
      region?: { x: number; y: number; w: number; h: number };
      displayId?: number;
    }): Promise<ActionResult> => {
      const ref = lastShot ?? undefined;
      const shot = await captureScreen({
        displayId,
        region: region && ref ? region : undefined,
        regionRef: region && ref ? ref : undefined,
      });
      if ("error" in shot) return { error: shot.error };
      lastShot = shot;
      lastSentSig = shot.signature;
      return {
        ok: true,
        message: `Screenshot taken (${shot.width}×${shot.height}). Coordinates are in this image's pixel space; (0,0) is top-left.`,
        shot,
      };
    },
  },
  {
    name: TOOLS.click,
    description:
      "Click the mouse at a point (in screenshot pixel coordinates). Pass x and y together to click a specific spot; omit both to click wherever the cursor already is (e.g. right after moveMouse). Optionally double-click or use the right/middle button. Returns a fresh screenshot by default.",
    inputSchema: z.object({
      x: z.number().optional().describe("X coordinate in the most recent screenshot's pixel space. Omit to click at the current cursor position."),
      y: z.number().optional().describe("Y coordinate in the most recent screenshot's pixel space. Omit to click at the current cursor position."),
      button: z.enum(["left", "right", "middle"]).optional().describe("Defaults to left."),
      double: z.boolean().optional().describe("Double-click when true."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const { x, y, button, double } = i as { x?: number; y?: number; button?: string; double?: boolean };
      const where = x != null && y != null ? ` at (${x}, ${y})` : "";
      return `${double ? "Double-" : ""}${button ?? "left"}-click${where}`;
    },
    toModelOutput: withScreenshot,
    execute: async ({
      x,
      y,
      button,
      double,
      screenshot,
    }: {
      x?: number;
      y?: number;
      button?: "left" | "right" | "middle";
      double?: boolean;
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      // Coordinates are optional: when both are given, move there first; when
      // omitted, click wherever the cursor already is (no move).
      const hasPoint = x != null && y != null;
      if (hasPoint) await moveTo(x, y);
      const btn = buttonOf(button);
      if (double) await mouse.doubleClick(btn);
      else await mouse.click(btn);
      const where = hasPoint ? ` at (${x}, ${y})` : " at the current cursor position";
      return finishAction(`Clicked${where}.`, screenshot ?? true);
    },
  },
  {
    name: TOOLS.moveMouse,
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
      await moveTo(x, y);
      return { ok: true, message: `Moved mouse to (${x}, ${y}).` };
    },
  },
  {
    name: TOOLS.drag,
    description:
      "Press and hold the mouse button at a start point, move to an end point, and release — for sliders, drag-and-drop, marquee selection, or moving windows. Coordinates are in screenshot pixel space. Omit from* to start the drag at the current cursor position. Returns a fresh screenshot by default.",
    inputSchema: z.object({
      fromX: z.number().optional(),
      fromY: z.number().optional(),
      toX: z.number(),
      toY: z.number(),
      button: z.enum(["left", "right", "middle"]).optional().describe("Defaults to left."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const { toX, toY } = i as { toX: number; toY: number };
      return `Drag to (${toX}, ${toY})`;
    },
    toModelOutput: withScreenshot,
    execute: async ({
      fromX,
      fromY,
      toX,
      toY,
      button,
      screenshot,
    }: {
      fromX?: number;
      fromY?: number;
      toX: number;
      toY: number;
      button?: "left" | "right" | "middle";
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const btn = buttonOf(button);
      if (fromX != null && fromY != null) await moveTo(fromX, fromY);
      const ref = lastShot;
      const target = ref ? toScreenPoint(toX, toY, ref) : { x: toX, y: toY };
      // Press, animate the move (so intermediate positions register), release.
      await mouse.pressButton(btn);
      await mouse.move(straightTo(new Point(target.x, target.y)));
      await mouse.releaseButton(btn);
      return finishAction(`Dragged to (${toX}, ${toY}).`, screenshot ?? true);
    },
  },
  {
    name: TOOLS.typeText,
    description:
      "Type a string of text at the current focus. Long text is pasted via the clipboard for speed and reliability; short text is typed key-by-key. Does not press Enter unless the text contains a newline. By default returns NO screenshot, so you can chain typing/keys; pass screenshot:true when you want to see the result.",
    inputSchema: z.object({
      text: z.string().describe("The literal text to type."),
      method: z
        .enum(["type", "paste"])
        .optional()
        .describe("Force key-by-key typing or clipboard paste. Omit to auto-choose (paste for long text)."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => {
      const t = (i as { text: string }).text;
      return `Type: "${t.length > 60 ? t.slice(0, 57) + "…" : t}"`;
    },
    toModelOutput: withScreenshot,
    execute: async ({
      text,
      method,
      screenshot,
    }: {
      text: string;
      method?: "type" | "paste";
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      const usePaste = method === "paste" || (method !== "type" && text.length > 25);
      if (usePaste) await pasteText(text);
      else await keyboard.type(text);
      return finishAction(`Typed ${text.length} character(s).`, screenshot ?? false);
    },
  },
  {
    name: TOOLS.pressKeys,
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
    name: TOOLS.scroll,
    description:
      "Scroll the screen in a direction by an amount (in scroll steps). Pass x and y to scroll the pane under that point (the cursor moves there first); omit them to scroll wherever the cursor is. Returns a fresh screenshot by default.",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().min(1).max(50).optional().describe("Scroll steps (default 5)."),
      x: z.number().optional().describe("X coordinate to scroll at (screenshot pixel space)."),
      y: z.number().optional().describe("Y coordinate to scroll at (screenshot pixel space)."),
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
      x,
      y,
      screenshot,
    }: {
      direction: "up" | "down" | "left" | "right";
      amount?: number;
      x?: number;
      y?: number;
      screenshot?: boolean;
    }): Promise<ActionResult> => {
      const access = ensureInputAccess();
      if ("error" in access) return access;
      ensureConfigured();
      if (x != null && y != null) await moveTo(x, y);
      const n = amount ?? 5;
      if (direction === "up") await mouse.scrollUp(n);
      else if (direction === "down") await mouse.scrollDown(n);
      else if (direction === "left") await mouse.scrollLeft(n);
      else await mouse.scrollRight(n);
      return finishAction(`Scrolled ${direction}.`, screenshot ?? true);
    },
  },
  {
    name: TOOLS.wait,
    description:
      "Pause briefly to let the screen finish loading or animating, then look. Cheaper and clearer than repeatedly screenshotting while you wait.",
    inputSchema: z.object({
      ms: z.number().min(0).max(3000).optional().describe("Milliseconds to wait (default 500, max 3000)."),
      screenshot: z.boolean().optional().describe(SHOT_ARG),
    }),
    summarize: (i) => `Wait ${(i as { ms?: number }).ms ?? 500}ms`,
    toModelOutput: withScreenshot,
    execute: async ({ ms, screenshot }: { ms?: number; screenshot?: boolean }): Promise<ActionResult> => {
      const d = Math.min(ms ?? 500, 3000);
      await delay(d);
      return finishAction(`Waited ${d}ms.`, screenshot ?? true);
    },
  },
];

// Operating manual appended to the system prompt when this skill is enabled, so
// the model drives the screenshot → act → screenshot loop correctly. Static
// (built from the host platform); contributed via the generic Skill.systemPrompt.
const platform =
  process.platform === "darwin"
    ? "macOS (use the Cmd key for shortcuts, not Ctrl)"
    : process.platform === "win32"
      ? "Windows (use the Ctrl key for shortcuts)"
      : "Linux (use the Ctrl key for shortcuts)";

const SYSTEM_PROMPT = `You can see and control this computer. The operating system is ${platform}.

To operate it: first call captureScreen to see the screen, then act with click, moveMouse, drag, typeText, pressKeys, scroll, and wait. Coordinates are in the pixel space of the most recent screenshot, with (0,0) at the top-left.

To read or precisely click something small, call captureScreen with a region to zoom into that area rather than guessing on the full frame — the zoomed image is sharper and the coordinates you get back refer to it. Use drag for sliders, drag-and-drop, selecting, or moving windows. To scroll a specific pane, pass x and y to scroll. Long text you pass to typeText is pasted instantly via the clipboard; short text is typed key-by-key. If something is still loading, use wait rather than screenshotting repeatedly.

Don't take a screenshot after every action — it's slow. typeText and pressKeys return no screenshot by default, so chain related keystrokes (e.g. type a field, press Tab, type the next, press Enter) without looking in between. click, drag, and scroll do return a screenshot since they change what's on screen. When you want to verify the result of a keystroke sequence, either pass screenshot:true on the last action or call captureScreen. Screenshots are settled before you see them, so you won't catch a half-loaded frame. If an action reports "no visible change on screen", your click probably missed — re-aim (zoom in to be sure) instead of repeating the same click.

The user can see a live list of every action, so keep spoken narration brief — don't give a play-by-play of each click; a short sentence to begin and a one-line summary at the end is enough.

Work in small, deliberate steps and stop once the task is done or if something looks wrong. If a screenshot is empty or a click has no effect, the operator may need to grant Screen Recording and Accessibility permissions in their system settings — say so rather than retrying blindly.`;

export const computerSkill: Skill = {
  ...meta,
  systemPrompt: SYSTEM_PROMPT,
  tools,
};
