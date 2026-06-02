import { DEX_THEMES } from "./registry";

// A small static preview glyph per theme (no live audio needed in the picker).
function Preview({ id }: { id: string }) {
  if (id === "dot") {
    return <span className="h-3 w-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]" />;
  }
  if (id === "cursor") {
    return <span className="h-6 w-1.5 rounded-[2px] bg-white animate-caret-blink" />;
  }
  // jarvis HUD reactor
  return (
    <span className="relative flex h-9 w-9 items-center justify-center">
      <span className="absolute inset-0 rounded-full border border-cyan-400/50 animate-dex-spin-slow" style={{ borderStyle: "dashed" }} />
      <span className="absolute inset-1.5 rounded-full border border-cyan-300/40" />
      <span className="h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
    </span>
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {DEX_THEMES.map((theme) => {
        const selected = theme.id === value;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onChange(theme.id)}
            title={theme.description}
            className={`flex flex-col items-center gap-3 rounded-xl border px-3 py-4 text-center transition ${
              selected
                ? "border-white/50 bg-white/[0.06]"
                : "border-white/10 bg-white/[0.02] hover:border-white/25"
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center">
              <Preview id={theme.id} />
            </span>
            <span className="text-xs font-medium text-white/90">{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
