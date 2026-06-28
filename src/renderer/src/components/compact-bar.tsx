import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Settings, X } from "lucide-react";
import { StatusDot } from "@/components/status-bar";
import { Button } from "@/components/ui/button";
import { ToolCardLayer } from "@skills/tool-card-layer";
import { STATUS_LABELS, type DexStatus } from "@/lib/dex/state";
import { cn } from "@/lib/utils";
import type { SessionToolInvocation } from "../../../main/ipc/channels";

// Notch height regions (px), summed by CompactBar to drive the window height.
const BAR_H = 44; // the always-visible bar (matches NOTCH_SIZE.height in main)
const CARD_H = 96; // body region for a tool-result card
const TYPE_H = 52; // the type field, revealed on hover/focus

// The notch bar's presentation. It fills its transparent host window (the notch
// window — see createNotchWindow), drawing a flat top edge flush to the screen
// and rounded bottom so it reads as hanging from the top "notch".
//
// At rest it shows only the status + a standby (mic) toggle. Hovering it (or
// focusing the type field, or the summon hotkey) reveals the expand + settings
// buttons and a minimalist type field. When a tool result is available it also
// shows that result as a card in the body, below the bar (under the physical
// notch), Dynamic-Island style. The host window grows downward to fit whatever
// is shown — the renderer sums the region heights and drives the window via
// setNotchHeight. State + callbacks are wired by NotchApp from the session relay.
export function CompactBar({
  status,
  caption,
  toolInvocations,
  agentName,
  isMuted,
  onSubmitText,
  onToggleMute,
  onNewConversation,
  onExpand,
  onOpenSettings,
}: {
  status: DexStatus;
  caption: string;
  toolInvocations: SessionToolInvocation[];
  agentName: string;
  isMuted: boolean;
  onSubmitText: (text: string) => void;
  onToggleMute: () => void;
  onNewConversation: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Stay expanded while hovered OR while the type field has focus. Expand
  // immediately; collapse half a second after both drop so a quick blur or
  // pointer drift doesn't snap the bar shut.
  const rawExpanded = hovered || typing;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (rawExpanded) {
      setExpanded(true);
      return;
    }
    const timer = setTimeout(() => setExpanded(false), 500);
    return () => clearTimeout(timer);
  }, [rawExpanded]);

  // When a tool result is available, the notch grows to show it as a card in the
  // body below the bar (Dynamic-Island style) — separate from the hover/type
  // expansion. Drive the host window's height from what's actually shown: the
  // bar, plus the card body, plus the type field when expanded.
  const hasCard = toolInvocations.length > 0;
  const targetHeight = BAR_H + (hasCard ? CARD_H : 0) + (expanded ? TYPE_H : 0);
  useEffect(() => {
    window.opendex.setNotchHeight(targetHeight);
  }, [targetHeight]);

  // The summon hotkey (⌥Space) focuses this window — reveal + focus the field so
  // the user can type immediately, Spotlight-style.
  useEffect(() => {
    const reveal = () => {
      setTyping(true);
      inputRef.current?.focus();
    };
    window.addEventListener("opendex:summon", reveal);
    return () => window.removeEventListener("opendex:summon", reveal);
  }, []);

  // Collapse when the notch loses focus (e.g. it's hidden on expand-to-full or a
  // summon toggle) so its expanded state never goes stale against the window
  // height, which main resets to collapsed whenever it re-shows the notch.
  useEffect(() => {
    const collapse = () => {
      setHovered(false);
      setTyping(false);
    };
    window.addEventListener("blur", collapse);
    return () => window.removeEventListener("blur", collapse);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmitText(text);
    setValue(""); // keep focus for quick follow-ups
  };

  const canInteract = status !== "unsupported";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex h-screen w-screen flex-col overflow-hidden rounded-b-2xl bg-black"
    >
      {/* Top bar. Left + right groups each take an equal share (flex-1) with a
          fixed empty gap between them; since the notch window is screen-centered,
          that gap lands under the physical laptop notch so nothing hides behind
          it. */}
      <div className="flex h-11 shrink-0 items-center pl-3.5 pr-2">
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

        {/* Mic stays pinned to the right edge; the expand + settings buttons are
            revealed to its LEFT so they appear away from the cursor after a mic
            click (no accidental hit on a button that wasn't there a moment ago). */}
        <div className="flex flex-1 items-center justify-end gap-1">
          {expanded && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onExpand}
                autoFocus={false}
                aria-label="Expand to full window"
                title="Expand to full window"
                className="rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Maximize2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                autoFocus={false}
                onClick={onOpenSettings}
                aria-label="Settings"
                className="rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Settings />
              </Button>
            </>
          )}
          {canInteract && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleMute}
              aria-pressed={isMuted}
              autoFocus={false}
              aria-label={isMuted ? "Resume listening" : "Stand by"}
              title={isMuted ? "On standby — click to resume" : "Listening — click to stand by"}
              className="rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {isMuted ? <MicOff /> : <Mic />}
            </Button>
          )}
        </div>
      </div>

      {/* Tool-result card — shown in the body, centred under the physical notch
          (which only covers the top bar), like the Dynamic Island. */}
      {hasCard && (
        <div className="flex shrink-0 justify-center px-3 pb-2">
          <div className="relative w-full max-w-[360px]">
            <ToolCardLayer invocations={toolInvocations} surface="notch" />
            <button
              type="button"
              onClick={onNewConversation}
              aria-label="Dismiss"
              title="Dismiss"
              className="absolute -right-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white"
            >
              <X className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* Type field — slides up from the bottom when expanded. Minimalist: a
          blinking caret + "Type to {name}" prompt while empty, native text once
          you start typing. */}
      {canInteract && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cn(
            "shrink-0 px-3.5 transition-all duration-200 ease-out",
            expanded ? "opacity-100" : "pointer-events-none h-0 overflow-hidden opacity-0",
          )}
        >
          <div
            onMouseDown={() => inputRef.current?.focus()}
            className="relative flex h-9 w-full items-center rounded-xl bg-white/[0.06] px-3"
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setValue("");
                  inputRef.current?.blur();
                }
              }}
              // Hide the native caret while empty so the synthetic blinking one
              // below is the only cursor (and it shows even when this window
              // isn't focused, signalling "ready to type").
              className={cn(
                "h-full w-full bg-transparent text-[13px] text-foreground/90 outline-none",
                value === "" && "caret-transparent",
              )}
              aria-label={`Type to ${agentName || "your assistant"}`}
            />
            {value === "" && (
              <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="inline-block h-[1.05em] w-[2px] animate-caret-blink rounded-[1px] bg-foreground/70" />
                <span>Type to {agentName || "your assistant"}</span>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
