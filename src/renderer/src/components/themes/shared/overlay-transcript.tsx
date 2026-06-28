import type { TranscriptTurn } from "@/lib/dex/state";
import type { ToolInvocation } from "@skills/tool-view";
import { ToolCardLayer } from "@skills/tool-card-layer";

// Bottom-anchored, boxless transcript for the minimal themes' overlay. Newest
// lines sit at the bottom; older ones rise and are clipped + faded by the
// shell's mask. No scrollbar — we just render the most recent turns. A tool
// result renders inline as the trailing item (a card in the thread), so it
// scrolls with the conversation rather than floating over it.
export function OverlayTranscript({
  turns,
  liveCaption,
  toolInvocations = [],
  variant,
}: {
  turns: TranscriptTurn[];
  liveCaption: string;
  toolInvocations?: ToolInvocation[];
  variant: "bubble" | "line";
}) {
  const recent = turns.slice(-8);

  return (
    <div className="flex flex-col justify-end gap-2 text-sm leading-relaxed">
      {recent.map((t) =>
        variant === "bubble" ? (
          <div
            key={t.id}
            className={
              t.role === "user"
                ? "max-w-[80%] self-end rounded-2xl bg-foreground/10 px-4 py-2 text-foreground"
                : "max-w-[85%] self-start text-foreground/85"
            }
          >
            {t.content || "…"}
          </div>
        ) : (
          <div key={t.id} className="flex gap-2">
            <span className={t.role === "user" ? "text-foreground/40" : "text-foreground/30"}>
              {t.role === "user" ? ">" : "·"}
            </span>
            <span className={t.role === "user" ? "text-foreground" : "text-foreground/70"}>
              {t.content || "…"}
            </span>
          </div>
        ),
      )}
      {/* Tool result — inline in the thread, after the latest reply. */}
      <ToolCardLayer
        invocations={toolInvocations}
        surface="main"
        className="max-w-[85%] self-start"
      />
      {liveCaption &&
        (variant === "bubble" ? (
          <div className="max-w-[80%] self-end px-4 py-2 italic text-foreground/45">
            {liveCaption}
          </div>
        ) : (
          <div className="flex gap-2 text-foreground/45">
            <span>{">"}</span>
            <span className="italic">{liveCaption}</span>
          </div>
        ))}
    </div>
  );
}
