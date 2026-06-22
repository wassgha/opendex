import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

// Hero "live demo": the Editorial-theme Dex window with other windows (a
// spreadsheet, a macOS-style music player) overlapping it and popping in/out —
// driven by Motion. A faux computer-use cursor fills the spreadsheet; the action
// hints render as a caption under the demo. Authored on a fixed surface and
// scaled with CSS `zoom` so the whole cluster fits its column with no clipping.

const DESIGN_W = 985;
const DESIGN_H = 400;
const DEX_W = 560;
const DEX_LEFT = Math.round((DESIGN_W - DEX_W) / 2); // centred when alone
const DEX_SHIFT = -150; // slides left only when the spreadsheet is up

const ROWS = [
  { region: "North America", q2: "$42.1k" },
  { region: "EMEA", q2: "$38.6k" },
  { region: "APAC", q2: "$29.4k" },
  { region: "LATAM", q2: "$12.2k" },
];
const Q3 = ["$50.2k", "$44.0k", "$37.8k", "$15.1k"];
const FINAL = "Done. Q3 is up 18% over Q2 — APAC led the jump.";
const EASE = [0.22, 0.7, 0.18, 1] as const;

const Caret = () => <span className="demo-caret" />;

export function HeroDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);

  const [narration, setNarration] = useState("Good to see you, this is Dex.");
  const [command, setCommand] = useState("");
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState("Standing by…");
  const [q3, setQ3] = useState(["", "", "", ""]);
  const [showSheet, setShowSheet] = useState(false);
  const [showMusic, setShowMusic] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [banner, setBanner] = useState<{ icon: string; text: string } | null>(null);
  const [cursor, setCursor] = useState({ x: 300, y: 360 });
  const [clicking, setClicking] = useState(false);

  // Fit the fixed surface to the column width via CSS zoom (scales layout too,
  // so there's no overflow box to clip).
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const fit = () => {
      const s = c.clientWidth / DESIGN_W;
      scaleRef.current = s;
      setScale(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Scripted timeline.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShowSheet(true);
      setQ3(Q3);
      setShowMusic(true);
      setPlaying(true);
      setNarration(FINAL);
      return;
    }
    let cancelled = false;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const type = async (set: (s: string) => void, text: string, per = 22) => {
      set("");
      for (let i = 1; i <= text.length; i++) {
        if (cancelled) return;
        set(text.slice(0, i));
        await delay(per);
      }
    };

    const moveTo = async (el: HTMLElement | null) => {
      const stage = stageRef.current;
      if (el && stage) {
        const sr = stage.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const s = scaleRef.current || 1;
        setCursor({
          x: (r.left + r.width / 2 - sr.left) / s,
          y: (r.top + r.height / 2 - sr.top) / s,
        });
      }
      await delay(740);
    };

    const click = async () => {
      setClicking(true);
      await delay(150);
      setClicking(false);
      await delay(110);
    };

    // Move the cursor to the Dex composer, click it, then type the command.
    const runCommand = async (text: string, pause = 420) => {
      await moveTo(composerRef.current);
      await click();
      setTyping(true);
      await type(setCommand, text, 30);
      await delay(pause);
      setCommand("");
      setTyping(false);
    };

    const sceneSpreadsheet = async () => {
      setStatus("Standing by…");
      setCommand("");
      setTyping(false);
      setBanner(null);
      setQ3(["", "", "", ""]);
      setShowSheet(false);
      await type(setNarration, "Good to see you, this is Dex.");
      await delay(900);

      await runCommand("fill in Q3 revenue by region");

      setStatus("Working…");
      await type(setNarration, "On it — opening Quarterly.numbers.", 18);
      setBanner({ icon: "▸", text: "Open · Numbers" });
      setShowSheet(true);
      await delay(950);

      setBanner({ icon: "▸", text: "Screenshot" });
      await delay(420);
      for (let i = 0; i < 4; i++) {
        await moveTo(cellRefs.current[i]);
        if (cancelled) return;
        setBanner({ icon: "▸", text: `Click · C${i + 2}` });
        await click();
        setBanner({ icon: "⌨", text: `Type · ${Q3[i]}` });
        setQ3((p) => p.map((v, j) => (j === i ? Q3[i] : v)));
        await delay(520);
      }

      setBanner(null);
      await type(setNarration, FINAL, 18);
      setStatus("Standing by…");
      await delay(2600);
      setShowSheet(false);
      await delay(850);
    };

    const sceneMusic = async () => {
      await runCommand("play something upbeat", 320);

      setStatus("Working…");
      await type(setNarration, "Putting on a playlist.");
      setBanner({ icon: "▸", text: "Open · Music" });
      setShowMusic(true);
      setPlaying(false);
      await delay(380);
      setPlaying(true);
      await type(setNarration, "Now playing — The Time (Dirty Bit).", 18);
      setStatus("Standing by…");
      setBanner(null);
      await delay(3600);

      setShowMusic(false);
      setPlaying(false);
      await delay(850);
    };

    (async () => {
      while (!cancelled) {
        await sceneSpreadsheet();
        if (cancelled) return;
        await sceneMusic();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div
        ref={stageRef}
        className="dex-stage relative text-[#f5efe6]"
        style={{ width: DESIGN_W, height: DESIGN_H, zoom: scale } as React.CSSProperties}
      >
        {/* Dex window (Editorial theme) — centred; slides left when the sheet is up */}
        <motion.div
          className="absolute z-10 overflow-hidden rounded-2xl border border-white/10 bg-[#16130f] shadow-2xl ring-1 ring-black/50"
          style={{ left: DEX_LEFT, top: 50, width: DEX_W }}
          animate={{ x: showSheet ? DEX_SHIFT : 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <div className="flex items-center gap-2 px-4 pt-3.5">
            <span className="h-3 w-3 rounded-full bg-[#ec6a5e]" />
            <span className="h-3 w-3 rounded-full bg-[#f4bf4f]" />
            <span className="h-3 w-3 rounded-full bg-[#61c554]" />
          </div>
          <div className="px-7 pb-6 pt-3">
            <div className="flex items-center gap-3 py-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f5efe6" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 4v16M4.5 7.5l15 9M19.5 7.5l-15 9" />
              </svg>
              <span className="demo-dot block h-2.5 w-2.5 rounded-full bg-[#e8916f]" />
              <span className="ml-auto grid h-6 w-6 place-items-center rounded-full border border-white/10 text-white/30">⚙</span>
            </div>
            <p className="demo-narration mt-2 h-[2.7em] max-w-[420px] overflow-hidden font-light leading-snug tracking-tight text-[#f5efe6]">
              {narration}
              <Caret />
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-[#a89a87]">
              <span className="h-1 w-1 rounded-full bg-[#da7756]" />
              <span>{status}</span>
            </div>
            <div ref={composerRef} className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-[#a89a87]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
              {typing || command ? (
                <span className="text-[#f5efe6]">{command}{typing && <Caret />}</span>
              ) : (
                <span>Type a message…</span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Spreadsheet — pops in on top of Dex, to the right */}
        <AnimatePresence>
          {showSheet && (
            <motion.div
              key="sheet"
              className="absolute z-20 overflow-hidden rounded-xl border border-black/10 bg-[#f3ede3] text-[#1a1714] shadow-2xl"
              style={{ left: 505, top: 0, width: 460 }}
              initial={{ opacity: 0, x: 26, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 26, scale: 0.96 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <div className="flex items-center gap-2 border-b border-black/10 bg-[#e7e0d4] px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-[#ec6a5e]" />
                <span className="h-3 w-3 rounded-full bg-[#f4bf4f]" />
                <span className="h-3 w-3 rounded-full bg-[#61c554]" />
                <span className="ml-2 text-[12px] font-bold text-black/60">Quarterly.numbers</span>
              </div>
              <div className="grid grid-cols-[1.5fr_1fr_1fr] text-[13px]">
                <div className="border-b border-black/10 bg-[#e7e0d4] px-3 py-2 font-bold">Region</div>
                <div className="border-b border-l border-black/10 bg-[#e7e0d4] px-3 py-2 font-bold">Q2</div>
                <div className="border-b border-l border-black/10 bg-[#e7e0d4] px-3 py-2 font-bold">Q3</div>
                {ROWS.map((row, i) => (
                  <div className="contents" key={row.region}>
                    <div className={`px-3 py-2 ${i < 3 ? "border-b border-black/5" : ""}`}>{row.region}</div>
                    <div className={`border-l border-black/5 px-3 py-2 text-black/60 ${i < 3 ? "border-b" : ""}`}>{row.q2}</div>
                    <motion.div
                      ref={(n) => { cellRefs.current[i] = n; }}
                      className={`border-l border-black/5 px-3 py-2 font-bold ${i < 3 ? "border-b" : ""}`}
                      animate={{
                        backgroundColor: q3[i]
                          ? ["rgba(218,119,86,0.4)", "rgba(218,119,86,0)"]
                          : "rgba(218,119,86,0)",
                      }}
                      transition={{ duration: 0.5 }}
                    >
                      {q3[i]}
                    </motion.div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Now-playing widget — compact macOS-style glass player */}
        <AnimatePresence>
          {showMusic && (
            <motion.div
              key="music"
              className="absolute z-30 rounded-[18px] border border-white/15 bg-black/55 p-3 shadow-2xl backdrop-blur-2xl"
              style={{ left: 420, top: 0, width: 328 }}
              initial={{ opacity: 0, y: -14, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.95 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <div className="flex items-center gap-3">
                <img src="./demo/cover.jpg" alt="" className="h-12 w-12 shrink-0 rounded-md object-cover shadow" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-white">The Time (Dirty Bit)</div>
                  <div className="truncate text-[12px] text-white/55">The Beginning (Deluxe)</div>
                </div>
                <svg width="22" height="13" viewBox="0 0 24 14" fill="white" className="shrink-0 opacity-80" aria-hidden="true">
                  <path d="M11 1 4 7l7 6z" /><path d="M13 1l7 6-7 6z" />
                </svg>
              </div>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/15">
                <motion.div
                  className="h-full rounded-full bg-white"
                  initial={{ width: "2%" }}
                  animate={{ width: playing ? "100%" : "2%" }}
                  transition={{ duration: playing ? 6 : 0, ease: "linear" }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/45">
                <span>0:00</span><span>−5:08</span>
              </div>
              <div className="mt-2 flex items-center justify-between px-2 text-white">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" aria-hidden="true">
                  <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M11 19V5l-9 7zM21 19V5l-9 7z" /></svg>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M13 5v14l9-7zM3 5v14l9-7z" /></svg>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" aria-hidden="true">
                  <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fake computer-use cursor */}
        <motion.svg
          className="pointer-events-none absolute left-0 top-0 z-40 drop-shadow-lg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          aria-hidden="true"
          animate={{ x: cursor.x, y: cursor.y, scale: clicking ? 0.78 : 1 }}
          transition={{
            x: { duration: 0.72, ease: [0.5, 0, 0.2, 1] },
            y: { duration: 0.72, ease: [0.5, 0, 0.2, 1] },
            scale: { duration: 0.12 },
          }}
        >
          <path d="M5 3l14 7-6 1.6L10 18z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
        </motion.svg>
      </div>

      {/* Action hints — the computer-use steps as a dark pill under the demo */}
      <div className="mt-6 flex h-8 items-center justify-center">
        <AnimatePresence mode="wait">
          {banner && (
            <motion.div
              key={banner.text}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-neutral-900 px-3.5 py-1.5 text-[12px] text-white/85 shadow-md"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <span className="text-white/60">{banner.icon}</span>
              <span>{banner.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
