export interface Trick {
  id: string;
  title: string;
  family?: string;
  description: string;
  requires: string[];
  platforms?: string[];
  needsScreen?: boolean;
  intro: string;
  steps: Array<{ tool?: string; input?: Record<string, unknown>; instruction?: string }>;
  success: string;
}

/** Recipes describe real actions; selecting one is never evidence of completion. */
export const TRICKS: readonly Trick[] = [
  {
    id: "gravity-playground", title: "Gravity playground",
    description: "Open a live particle field you can pull around with the pointer.",
    requires: ["tricks"], intro: "Let me put a little gravity on your desktop.",
    steps: [{ tool: "showPlayground", input: { scene: "orbit" } }],
    success: "After the playground opens, a useful optional line is: Move your pointer around — they follow you. Skip this if you already introduced the scene. Do not claim you generated the built-in scene.",
  },
  {
    id: "world-weather", family: "world-facts", title: "Two cities, one moment",
    description: "Compare real weather and local time in Reykjavík and Singapore.",
    requires: ["weather", "clock"], intro: "Let's jump from Iceland to Singapore without leaving your desk.",
    steps: [
      { tool: "getWeather", input: { location: "Reykjavik" } },
      { tool: "getWeather", input: { location: "Singapore" } },
      { tool: "getCurrentTime", input: { timezone: "Atlantic/Reykjavik" } },
      { tool: "getCurrentTime", input: { timezone: "Asia/Singapore" } },
    ],
    success: "Give a short contrast grounded in the returned times and temperatures. Let the existing weather/time cards show the data. These are demo destinations, not the user's location. Do not make up forecasts when requests fail.",
  },
  {
    id: "date-line", family: "world-facts", title: "A small jump through time",
    description: "Use live clocks to show the same instant on opposite sides of the date line.",
    requires: ["clock"], intro: "I can show you the same moment on two different calendar dates.",
    steps: [
      { tool: "getCurrentTime", input: { timezone: "Pacific/Kiritimati" } },
      { tool: "getCurrentTime", input: { timezone: "Pacific/Honolulu" } },
    ],
    success: "Share the interesting date and local-time contrast from the actual results in one short sentence. Frame this as a live time-zone demonstration, not literal time travel.",
  },
  {
    id: "curiosity-search", title: "A tiny rabbit hole",
    description: "Open a ready-made search for glowing ocean waves.",
    requires: ["open"], intro: "Here's a small rabbit hole: ocean waves that glow at night.",
    steps: [{ tool: "openUrl", input: { url: "https://www.google.com/search?q=bioluminescent%20ocean%20waves" } }],
    success: "On success, let the browser opening be the result. One optional content-focused line: These waves glow at night. Do not add a completion report, verification disclaimer, or explanation of APIs. Do not claim to have read the search results or seen the page.",
  },
  {
    id: "window-boomerang", title: "Window boomerang",
    description: "Bring Safari forward, minimize its window, then restore that same window.",
    requires: ["open", "computer"], platforms: ["darwin"],
    intro: "Watch Safari disappear and come right back, with its window intact.",
    steps: [
      { tool: "openApp", input: { name: "Safari" } },
      { tool: "controlDesktop", input: { action: "minimize" } },
      { tool: "controlDesktop", input: { action: "restore" } },
    ],
    success: "The same minimized window was restored. Execute sequentially and only continue after each action succeeds. Don't use screenshots, close tabs, change volume, or change window size for this trick.",
  },
  {
    id: "screen-detective", title: "Screen detective",
    description: "Read the current screen and point out something useful about the task in front of you.",
    requires: ["computer"], needsScreen: true,
    intro: "Let’s see what’s useful on your screen.",
    steps: [{ tool: "describeScreen", input: {} }],
    success: "Name the observed app or page and give the useful observation and next step from the fresh screen result in at most two short sentences. Do not infer blocked inputs from an activity indicator. Do not recite generic interface furniture, suggest starting a new chat without a reason, or offer to perform the suggested action. If unavailable, explain the limitation rather than pretending to see the screen.",
  },
];

export interface TrickCapabilities { skills: readonly string[]; platform: string; canControl: boolean; canCapture: boolean }
export function eligibleTricks(capabilities: TrickCapabilities): Trick[] {
  const skills = new Set(capabilities.skills);
  return TRICKS.filter(trick => trick.requires.every(id => skills.has(id))
    && (!trick.platforms || trick.platforms.includes(capabilities.platform))
    && (!trick.requires.includes("computer") || capabilities.canControl)
    && (!trick.needsScreen || capabilities.canCapture));
}

export class TrickPicker {
  private seen = new Set<string>();
  private last: string | undefined;
  constructor(private random: () => number = Math.random) {}
  choose(available: readonly Trick[], id?: string) {
    if (id) {
      const requested = available.find(trick => trick.id === id);
      if (requested) this.remember(requested.id);
      return requested;
    }
    if (!available.length) return undefined;
    let candidates = available.filter(trick => !this.seen.has(trick.id));
    if (!candidates.length) {
      this.seen.clear();
      candidates = available.filter(trick => available.length === 1 || trick.id !== this.last);
    }
    const previous = available.find(trick => trick.id === this.last);
    const different = candidates.filter(trick => (trick.family ?? trick.id) !== (previous?.family ?? previous?.id));
    if (different.length) candidates = different;
    const firstShowpiece = !this.last && candidates.find(trick => trick.id === "gravity-playground");
    const selected = firstShowpiece || candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    this.remember(selected.id);
    return selected;
  }
  private remember(id: string) { this.seen.add(id); this.last = id; }
}
