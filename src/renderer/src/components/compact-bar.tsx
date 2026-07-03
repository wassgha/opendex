import { useEffect, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, Mic, MicOff, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolCardLayer } from "@skills/tool-card-layer";
import type { DexStatus } from "@/lib/dex/state";
import { cn } from "@/lib/utils";
import type { SessionToolInvocation } from "../../../main/ipc/channels";

// Notch sizing (px). The window stays screen-centered, so a fixed center gap
// always lands under the physical laptop notch and the two wings (flex-1, equal
// share) keep it centered at any width.
const NOTCH_GAP = 190; // reserved center gap ≈ physical notch width
const COMPACT_WIDTH = 200; // at rest: status indicator + mic, no text
const WIDE_WIDTH = 420; // expanded for a caption / controls / type field
const BAR_H = 44; // the always-visible bar
const CARD_H = 80; // body region for a tool-result card'
const CAPTION_H = 36; // body region for a caption
const TYPE_H = 42; // the type field, revealed on hover/focus

// The notch bar's presentation. It fills its transparent, screen-centered host
// window (createNotchWindow), drawing a flat top edge flush to the screen and a
// rounded bottom so it reads as hanging from the top "notch".
//
// At rest it's compact — just the theme's status indicator + a standby (mic)
// toggle, no text. It grows (animated by the window resize, driven via
// setNotchSize) when there's a caption, a result card, or the hover-revealed
// type field. The status indicator is supplied by the active theme, so a theme
// can give the notch its own glyph. State + callbacks are wired by NotchApp.
export function CompactBar({
  status,
  caption,
  toolInvocations,
  agentName,
  isMuted,
  StatusIndicator,
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
  /** The active theme's status indicator (defaults to StatusDot in NotchApp). */
  StatusIndicator: ComponentType<{ status: DexStatus }>;
  onSubmitText: (text: string) => void;
  onToggleMute: () => void;
  onNewConversation: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Pinned open by the keyboard summon (no pointer involved); cleared on
  // submit / Escape / when the window is hidden.
  const [pinned, setPinned] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Expand while the pointer is anywhere over the notch (bar OR the revealed
  // field — it's one window, so moving between them stays "hovered"), or while
  // pinned by summon. Expansion is NOT tied to input focus: an incidentally
  // focused field (e.g. on an empty desktop, where nothing blurs it) must not
  // keep it open. Collapse half a second after hover drops so a quick pointer
  // drift doesn't snap it shut.
  const hasText = value.trim().length > 0;
  const rawExpanded = hovered || pinned || hasText;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (rawExpanded) {
      setExpanded(true);
      return;
    }
    const timer = setTimeout(() => setExpanded(false), 200);
    return () => clearTimeout(timer);
  }, [rawExpanded]);

  const hasCard = toolInvocations.length > 0;
  const hasCaption = caption.length > 0;

  // Drive the host window. Width is two-tier (compact at rest, wide when there's
  // something to show) so the centered gap stays under the physical notch; height
  // grows downward for the card + type field. The window animates between sizes.
  const width = hasCard || expanded ? WIDE_WIDTH : COMPACT_WIDTH;
  const height = BAR_H + (hasCard ? CARD_H : 0) + (hasCaption ? CAPTION_H : 0) + (expanded ? TYPE_H : 0);
  useEffect(() => {
    window.opendex.setNotchSize(width, height);
  }, [width, height]);

  // The summon hotkey (⌥Space) opens it without a pointer — pin it open + focus
  // the field so the user can type immediately, Spotlight-style.
  useEffect(() => {
    const reveal = () => {
      setPinned(true);
      window.opendex.focusNotch();
      inputRef.current?.focus();
    };
    window.addEventListener("opendex:summon", reveal);
    return () => window.removeEventListener("opendex:summon", reveal);
  }, []);

  // Reset to collapsed whenever the notch window is shown or hidden, or loses
  // focus. The notch is shown with showInactive (never focused) and can hide
  // while the cursor is still over it — so onMouseLeave doesn't reliably fire and
  // `hovered` would get stuck. A real hover re-expands via onMouseEnter.
  useEffect(() => {
    const collapse = () => {
      setHovered(false);
      setPinned(false);
    };
    document.addEventListener("visibilitychange", collapse);
    window.addEventListener("blur", collapse);
    return () => {
      document.removeEventListener("visibilitychange", collapse);
      window.removeEventListener("blur", collapse);
    };
  }, []);

  // When it collapses, drop keyboard focus so the now-hidden field can't keep
  // capturing keystrokes.
  useEffect(() => {
    if (!expanded) inputRef.current?.blur();
  }, [expanded]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmitText(text);
    setValue("");
    setPinned(false); // close after sending (stays open if still hovered)
  };

  // The notch is shown unfocused (showInactive), so keystrokes only reach it once
  // it has OS keyboard focus. Focus when the pointer reaches the type field (a
  // deliberate move onto it) — so you can type without a click, but merely
  // glancing at / hovering the bar never steals focus from the foreground app.
  const focusField = () => {
    window.opendex.focusNotch();
    inputRef.current?.focus();
  };

  const canInteract = status !== "unsupported";

  // Icon buttons are mouse-only (tabIndex -1) so the notch never auto-focuses one
  // when the window is shown — which left the mic with a persistent focus ring.
  const iconButton =
    "rounded-full text-muted-foreground hover:text-foreground cursor-pointer";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex h-screen w-screen flex-col overflow-hidden rounded-b-2xl bg-black"
    >
      {/* Top bar: equal-share wings (so the fixed center gap stays centered under
          the physical notch) — status indicator + optional caption on the left,
          controls on the right. */}
      <div className="flex w-full h-10 shrink-0 items-start pl-2 pr-2">
        <div className="flex h-9 min-w-0 flex-1 items-center justify-start pl-3 gap-2">
          <StatusIndicator status={status} />
        </div>

        <div className="shrink-0 h-9" style={{ width: NOTCH_GAP }} aria-hidden />

        <div className="flex flex-1 h-9 items-center justify-start gap-1">
          <AnimatePresence>
            {canInteract && (
              <motion.div
                key="mic"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={-1}
                  onClick={onToggleMute}
                  aria-pressed={isMuted}
                  aria-label={isMuted ? "Resume listening" : "Stand by"}
                  title={isMuted ? "On standby — click to resume" : "Listening — click to stand by"}
                  className={iconButton}
                >
                  {isMuted ? <MicOff /> : <Mic />}
                </Button>
              </motion.div>
            )}
            {expanded && (
              <motion.div
                key="expand-controls"
                className="flex items-center gap-1"
                initial={{ opacity: 0, scale: 0.6, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: "auto" }}
                exit={{ opacity: 0, scale: 0.6, width: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={-1}
                  onClick={onExpand}
                  aria-label="Expand to full window"
                  title="Expand to full window"
                  className={iconButton}
                >
                  <Maximize2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={-1}
                  onClick={onOpenSettings}
                  aria-label="Settings"
                  className={iconButton}
                >
                  <Settings />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Speech */}
      <AnimatePresence>
        {hasCaption && (
          <motion.div
            key="caption"
            className="min-w-0 truncate text-[13px] mb-2 text-foreground/80 px-3 py-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tool-result card — in the body, below the bar (the physical notch only
          covers the top bar), Dynamic-Island style. */}
      <AnimatePresence>
        {hasCard && (
          <motion.div
            key="tool-card"
            className="flex shrink-0 justify-center px-3 pb-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="relative w-full max-w-[360px]">
              <ToolCardLayer invocations={toolInvocations} surface="notch" />
              <button
                type="button"
                tabIndex={-1}
                onClick={onNewConversation}
                aria-label="Dismiss"
                title="Dismiss"
                className="absolute -right-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white"
              >
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Type field — revealed when expanded; the window grows to reveal it. */}
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
            className="relative flex h-9 w-full items-center rounded-xl bg-white/[0.06] px-3"
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setValue("");
                  setPinned(false);
                  inputRef.current?.blur();
                }
              }}
              className={cn(
                "h-full w-full bg-transparent text-[13px] text-foreground/90 outline-none pr-6",
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
            <AnimatePresence>
              {hasText && (
                <motion.button
                  type="button"
                  tabIndex={-1}
                  key="clear"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  onClick={() => {
                    setValue("");
                    setPinned(false);
                    inputRef.current?.blur();
                  }}
                  aria-label="Clear and close"
                  className="absolute right-2 grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </form>
      )}
    </div>
  );
}
