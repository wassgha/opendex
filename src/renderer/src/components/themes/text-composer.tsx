import { useEffect, useRef, useState } from "react";

// A concealed typing affordance: voice stays the primary input, but a small,
// unobtrusive control lets you type a command when you can't (or don't want to)
// speak. Collapsed it's just a subtle pill; clicking it reveals an input that
// submits through the same agent path. Esc collapses it again.
export function TextComposer({
  onSubmit,
  tone = "minimal",
  className = "",
}: {
  onSubmit: (text: string) => void;
  tone?: "minimal" | "jarvis";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue(""); // keep open for quick follow-ups
  };

  const jarvis = tone === "jarvis";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Type a message instead"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.25em] transition ${
          jarvis
            ? "border-cyan-400/25 bg-cyan-500/5 font-mono text-cyan-300/60 hover:bg-cyan-500/15 hover:text-cyan-100"
            : "border-white/10 bg-white/[0.03] text-white/35 hover:bg-white/[0.07] hover:text-white/70"
        } ${className}`}
      >
        <KeyboardGlyph />
        Type
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`flex items-center gap-2 rounded-full border px-2 py-1.5 backdrop-blur ${
        jarvis
          ? "border-cyan-400/30 bg-cyan-950/40"
          : "border-white/15 bg-black/50"
      } ${className}`}
    >
      <KeyboardGlyph
        className={jarvis ? "ml-1 text-cyan-300/60" : "ml-1 text-white/40"}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            setOpen(false);
          }
        }}
        placeholder="Type a message…"
        className={`w-56 bg-transparent text-sm outline-none placeholder:opacity-40 ${
          jarvis ? "font-mono text-cyan-50 placeholder:text-cyan-200" : "text-white placeholder:text-white"
        }`}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider transition disabled:opacity-30 ${
          jarvis
            ? "bg-cyan-400/20 font-mono text-cyan-50 hover:bg-cyan-400/30"
            : "bg-white text-black hover:bg-white/90"
        }`}
      >
        Send
      </button>
    </form>
  );
}

function KeyboardGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}
