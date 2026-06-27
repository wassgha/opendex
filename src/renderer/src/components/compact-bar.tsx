import { Maximize2, Mic, MicOff, Settings } from "lucide-react";
import { StatusDot } from "@/components/status-bar";
import { TextComposer } from "@/components/themes/text-composer";
import { Button } from "@/components/ui/button";
import { STATUS_LABELS, type DexStatus } from "@/lib/dex/state";

// The notch bar's presentation. It fills its transparent host window (the notch
// window — see createNotchWindow), drawing a flat top edge flush to the screen
// and rounded bottom so it reads as hanging from the top "notch". Purely
// presentational: state + callbacks are wired by NotchApp from the session relay.
export function CompactBar({
  status,
  caption,
  isMuted,
  onSubmitText,
  onToggleMute,
  onExpand,
  onOpenSettings,
}: {
  status: DexStatus;
  caption: string;
  isMuted: boolean;
  onSubmitText: (text: string) => void;
  onToggleMute: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="titlebar-drag flex h-screen w-screen items-center rounded-b-2xl bg-black pl-3.5 pr-2">
      {/* Left + right groups each take an equal share (flex-1), with a fixed
          empty gap between them. Because the notch window is screen-centered, an
          equally-balanced gap lands directly under the physical laptop notch —
          so neither the caption nor the controls ever sit behind it. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StatusDot status={status} />
        <div className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
          {caption || (
            <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
          )}
        </div>
      </div>

      {/* Reserved center gap sized to roughly the physical notch width. */}
      <div className="w-[200px] shrink-0" aria-hidden />

      <div className="titlebar-no-drag flex flex-1 items-center justify-end gap-1">
        <TextComposer onSubmit={onSubmitText} className="max-w-[200px]" />
        {status !== "unsupported" && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? "Resume listening" : "Stand by"}
            title={isMuted ? "On standby — click to resume" : "Listening — click to stand by"}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            {isMuted ? <MicOff /> : <Mic />}
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
