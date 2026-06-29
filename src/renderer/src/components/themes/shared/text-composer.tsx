import { useEffect, useRef, useState } from "react";
import { Keyboard, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// A concealed typing affordance: voice stays the primary input, but a small,
// unobtrusive control lets you type a command when you can't (or don't want to)
// speak. Collapsed it's just a subtle pill; clicking it reveals an input that
// submits through the same agent path. It styles itself entirely from theme
// tokens, and is always escapable — via the X button or the Esc key.
export function TextComposer({
  onSubmit,
  className = "",
}: {
  onSubmit: (text: string) => void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The summon hotkey (⌥Space) fires this window-level signal; reveal + focus
  // the input so the user can type immediately, Spotlight-style.
  useEffect(() => {
    const reveal = () => {
      inputRef.current?.focus();
    };
    window.addEventListener("opendex:summon", reveal);
    return () => window.removeEventListener("opendex:summon", reveal);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue(""); // keep open for quick follow-ups
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "flex w-full min-w-0 max-w-md items-center gap-1.5 rounded-full border border-input bg-dex-surface/80 py-1.5 pl-3 pr-1.5 backdrop-blur",
        className,
      )}
    >
      <Keyboard className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        placeholder="Type a message…"
        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
      <Button
        type="submit"
        size="icon-sm"
        disabled={!value.trim()}
        aria-label="Send"
        className="shrink-0 rounded-full"
      >
        <Send />
      </Button>
    </form>
  );
}
