import { Maximize2, Mic, MicOff, Settings } from "lucide-react";
import { StatusDot } from "@/components/status-bar";
import { TextComposer } from "@/components/themes/text-composer";
import { Button } from "@/components/ui/button";
import type { UseDexResult } from "@/lib/dex/use-dex";

// The notch / floating layout: a slim, top-pinned, always-on-top bar that the
// main window collapses into when it loses focus (the window is resized +
// repositioned flush to the top edge in the main process; this just renders the
// compact chrome). Voice keeps running underneath — this is purely a smaller
// surface to type at it, mute it, see its latest line, and expand back. The
// whole strip is draggable except its interactive controls.
export function CompactBar({
  dex,
  name,
  onOpenSettings,
  onExpand,
}: {
  dex: UseDexResult;
  name?: string;
  onOpenSettings: () => void;
  onExpand: () => void;
}) {
  // Show the freshest line: the assistant's spoken text while replying,
  // otherwise the live transcription of what the user is saying.
  const caption =
    dex.status === "speaking" || dex.status === "thinking"
      ? dex.spokenCaption || dex.liveCaption
      : dex.liveCaption;

  return (
    // Square top (flush to the screen edge), softly rounded bottom — reads as a
    // bar hanging from the top of the display.
    <div className="titlebar-drag flex h-full w-full items-center gap-2 rounded-b-xl bg-dex-surface/95 pl-3 pr-1.5 backdrop-blur">
      <StatusDot status={dex.status} />

      <div className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
        {caption || (
          <span className="text-muted-foreground">
            {name ? `${name} is standing by…` : "Standing by…"}
          </span>
        )}
      </div>

      <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
        <TextComposer onSubmit={dex.submitText} className="max-w-[200px]" />
        {dex.status !== "unsupported" && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={dex.toggleMute}
            aria-pressed={dex.isMuted}
            aria-label={dex.isMuted ? "Resume listening" : "Stand by"}
            title={dex.isMuted ? "On standby — click to resume" : "Listening — click to stand by"}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            {dex.isMuted ? <MicOff /> : <Mic />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onExpand}
          aria-label="Expand to full window"
          title="Expand to full window"
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Maximize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Settings />
        </Button>
      </div>
    </div>
  );
}
