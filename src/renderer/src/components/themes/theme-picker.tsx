import { DEX_THEMES } from "./registry";
import { cn } from "@/lib/utils";

// The preview glyph now lives with each theme (theme.Preview), so this picker is
// fully data-driven — a new theme folder shows up here with no edit.
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
              <theme.Preview />
            </span>
            <span className="text-xs font-medium text-foreground/90">{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
