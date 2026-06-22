// Hero "live demo": the Editorial-theme Dex window sits centred while other
// windows (a spreadsheet, a macOS-style music player) pop in/out around it —
// sliding Dex aside when a window needs the room. A faux computer-use cursor
// fills the spreadsheet. Pure DOM/CSS — no real app. The scene is authored at a
// fixed 1000×625 design size and uniformly scaled to the stage width.

const stage = document.getElementById("hero-stage");
const inner = document.getElementById("dex-demo");

function el<T extends Element = HTMLElement>(sel: string): T | null {
  return inner ? inner.querySelector<T>(sel) : null;
}

const dexWin = document.getElementById("demo-dex");
const sheet = document.getElementById("demo-sheet");
const music = document.getElementById("demo-music");
const musicBar = document.getElementById("demo-music-bar");
const narration = el("[data-narration]");
const statusEl = el("[data-status]");
const cmd = el("[data-command]");
const cmdCaret = el<HTMLElement>("[data-command-caret]");
const cmdPlaceholder = el<HTMLElement>("[data-command-placeholder]");
const banner = document.getElementById("demo-banner");
const bannerText = el("[data-banner-text]");
const bannerIcon = el("[data-banner-icon]");
const cursor = document.getElementById("demo-cursor");
const q3 = [0, 1, 2, 3].map((i) => el<HTMLElement>(`[data-q3="${i}"]`));

const ready =
  stage &&
  inner &&
  dexWin &&
  sheet &&
  music &&
  musicBar &&
  narration &&
  statusEl &&
  cmd &&
  cmdCaret &&
  cmdPlaceholder &&
  banner &&
  bannerText &&
  bannerIcon &&
  cursor &&
  q3.every(Boolean);

if (ready) {
  // Scale the fixed design surface to the stage width.
  let scale = 1;
  const fit = () => {
    scale = stage!.clientWidth / 1000;
    inner!.style.transform = `scale(${scale})`;
  };
  fit();
  new ResizeObserver(fit).observe(stage!);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Q3_VALUES = ["$50.2k", "$44.0k", "$37.8k", "$15.1k"];
  const FINAL_NARRATION = "Done. Q3 is up 18% over Q2 — APAC led the jump.";

  // ── helpers ──────────────────────────────────────────────────────────────
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function type(node: Element, text: string, per = 26) {
    node.textContent = "";
    for (const ch of text) {
      node.textContent += ch;
      await delay(per);
    }
  }

  const setStatus = (s: string) => {
    statusEl!.textContent = s;
  };

  function openSheet() {
    sheet!.style.opacity = "1";
    sheet!.style.transform = "translate(0, -50%) scale(1)";
  }
  function closeSheet() {
    sheet!.style.opacity = "0";
    sheet!.style.transform = "translate(24px, -50%) scale(0.96)";
  }

  function openMusic() {
    music!.style.opacity = "1";
    music!.style.transform = "translate(-50%, 0) scale(1)";
  }
  function closeMusic() {
    music!.style.opacity = "0";
    music!.style.transform = "translate(-50%, -12px) scale(0.95)";
  }

  function moveCursor(x: number, y: number) {
    cursor!.style.left = `${x}px`;
    cursor!.style.top = `${y}px`;
  }
  // Place the cursor over an element's centre, in design coordinates.
  async function moveCursorTo(target: Element) {
    const box = inner!.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    moveCursor(
      (r.left + r.width / 2 - box.left) / scale,
      (r.top + r.height / 2 - box.top) / scale,
    );
    await delay(740);
  }
  async function click() {
    cursor!.classList.add("is-clicking");
    await delay(140);
    cursor!.classList.remove("is-clicking");
    await delay(120);
  }

  function showBanner(icon: string, text: string) {
    bannerIcon!.textContent = icon;
    bannerText!.textContent = text;
    banner!.style.opacity = "1";
    banner!.style.transform = "translateY(0)";
  }
  function hideBanner() {
    banner!.style.opacity = "0";
    banner!.style.transform = "translateY(-8px)";
  }

  async function command(text: string) {
    cmdPlaceholder!.hidden = true;
    cmdCaret!.hidden = false;
    await type(cmd!, text, 30);
    await delay(420);
  }
  function clearCommand() {
    cmd!.textContent = "";
    cmdCaret!.hidden = true;
    cmdPlaceholder!.hidden = false;
  }

  // ── scenes ───────────────────────────────────────────────────────────────
  async function sceneSpreadsheet() {
    setStatus("Standing by…");
    clearCommand();
    hideBanner();
    q3.forEach((c) => c && (c.textContent = ""));
    await type(narration!, "Good to see you, this is Dex.", 22);
    await delay(900);

    await command("fill in Q3 revenue by region");
    clearCommand();
    setStatus("Working…");
    await type(narration!, "On it — opening Quarterly.numbers.", 18);
    showBanner("▸", "openApp  ·  Numbers");
    openSheet();
    await delay(900);

    showBanner("▸", "captureScreen");
    await delay(420);
    for (let i = 0; i < q3.length; i++) {
      const cell = q3[i]!;
      await moveCursorTo(cell);
      showBanner("▸", `click  ·  C${i + 2}`);
      await click();
      showBanner("⌨", `type  ·  ${Q3_VALUES[i]}`);
      cell.textContent = Q3_VALUES[i];
      cell.classList.remove("cell-pop");
      void cell.offsetWidth; // restart the pop animation
      cell.classList.add("cell-pop");
      await delay(520);
    }

    hideBanner();
    await type(narration!, FINAL_NARRATION, 18);
    setStatus("Standing by…");
    await delay(2400);
    closeSheet();
    await delay(800);
  }

  async function sceneMusic() {
    await command("play something upbeat");
    clearCommand();
    setStatus("Working…");
    await type(narration!, "Putting on a playlist.", 22);
    showBanner("▸", "openApp  ·  Music");
    openMusic();
    await delay(360);
    musicBar!.style.width = "100%"; // 6s linear progress (CSS transition)
    await type(narration!, "Now playing — The Time (Dirty Bit).", 18);
    setStatus("Standing by…");
    hideBanner();
    await delay(3200);

    closeMusic();
    musicBar!.style.transition = "none";
    musicBar!.style.width = "2%";
    await delay(60);
    musicBar!.style.transition = ""; // restore the CSS-class transition
    await delay(800);
  }

  async function run() {
    hideBanner();
    for (;;) {
      await sceneSpreadsheet();
      await sceneMusic();
    }
  }

  // ── dispatch (after all helpers/consts are initialized) ────────────────────
  if (reduce) {
    // Static, coherent end-state — Dex centred with the music player open above.
    narration!.textContent = "Good to see you, this is Dex.";
    setStatus("Standing by…");
    openMusic();
  } else {
    void run();
  }
}
