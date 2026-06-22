const THEMES = [
  {
    img: "./screenshots/jarvis.png",
    alt: "Jarvis HUD theme",
    name: "Jarvis HUD",
    note: " — cyan Stark-style heads-up display.",
  },
  {
    img: "./screenshots/typing-cursor.png",
    alt: "Typing Cursor theme",
    name: "Typing Cursor",
    note: " — a quiet terminal caret.",
  },
  {
    img: "./screenshots/hud-selection.png",
    alt: "Theme selection",
    name: "…and more",
    note: " — Talking Dot & warm Editorial.",
  },
];

export function Themes() {
  return (
    <section id="themes" className="border-t border-neutral-100">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-neutral-400">
          Pick your interface
        </h2>
        <p className="mt-3 max-w-2xl text-neutral-500">
          A theme renders the entire experience — visualization, transcript, and controls. Switch
          any time.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {THEMES.map((theme) => (
            <figure key={theme.name}>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-950">
                <img
                  src={theme.img}
                  alt={theme.alt}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
              </div>
              <figcaption className="mt-3 text-sm">
                <span className="font-bold">{theme.name}</span>
                <span className="text-neutral-500">{theme.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
