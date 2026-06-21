import { DEX_THEMES } from "./registry";
import { cn } from "@/lib/utils";

// A small static preview glyph per theme (no live audio needed in the picker).
function Preview({ id }: { id: string }) {
  if (id === "dot") {
    return <span className="h-3 w-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]" />;
  }
  if (id === "cursor") {
    return <span className="h-6 w-1.5 rounded-[2px] bg-white animate-caret-blink" />;
  }
  if (id === "editorial") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-lg font-light leading-none text-[#f5efe6]">A</span>
        <span className="h-2 w-2 rounded-full bg-[#da7756] shadow-[0_0_10px_rgba(218,119,86,0.8)]" />
      </span>
    );
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {DEX_THEMES.map((theme) => {
        const selected = theme.id === value;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onChange(theme.id)}
            title={theme.description}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border px-3 py-4 text-center transition",
              selected
                ? "border-ring bg-accent"
                : "border-border bg-card/40 hover:border-ring/50",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#0b0b0c]">
              <Preview id={theme.id} />
            </span>
            <span className="text-xs font-medium text-foreground/90">{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
