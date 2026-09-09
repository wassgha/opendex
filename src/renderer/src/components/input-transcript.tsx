import { useEffect, useRef } from "react";

export function InputTranscript({ text, interim = false }: { text: string; interim?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (interim && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [text, interim]);
  if (!text.trim()) return null;
  return (
    <div
      ref={viewport}
      role="region"
      aria-label="Your input transcript"
      tabIndex={0}
      className="max-h-24 overflow-y-auto overscroll-contain px-4 py-2 text-sm leading-relaxed text-foreground select-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="mr-2 text-xs font-medium text-muted-foreground">{interim ? "You · live preview" : "You"}</span>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}
