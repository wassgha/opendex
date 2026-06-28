// Small helpers shared by tool-view label functions (banner text).

export function truncate(s: string, n = 48): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

const KEY_SYMBOL: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  super: "⌘",
  win: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  ctrl: "⌃",
  control: "⌃",
  enter: "⏎",
  return: "⏎",
  esc: "⎋",
  escape: "⎋",
};

export function prettyKey(k: string): string {
  return KEY_SYMBOL[k.toLowerCase()] ?? k.toUpperCase();
}
