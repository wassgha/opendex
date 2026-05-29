"use client";

import { useEffect, useRef } from "react";
import type { TranscriptTurn } from "@/lib/jarvis/state";

export function Transcript({
  turns,
  liveCaption,
}: {
  turns: TranscriptTurn[];
  liveCaption: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, liveCaption]);

  if (turns.length === 0 && !liveCaption) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/30">
        Say “Jarvis” followed by a request.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-3 overflow-y-auto px-2 pb-6 pt-2 scroll-smooth"
    >
      {turns.map((turn) => (
        <div
          key={turn.id}
          className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
            turn.role === "user"
              ? "self-end bg-white/10 text-white"
              : "self-start bg-cyan-500/10 text-cyan-50 border border-cyan-400/20"
          }`}
        >
          {turn.content || (turn.role === "assistant" ? "…" : "")}
        </div>
      ))}
      {liveCaption && (
        <div className="self-end max-w-[80%] rounded-2xl px-4 py-2 text-sm italic text-white/50">
          {liveCaption}
        </div>
      )}
    </div>
  );
}
