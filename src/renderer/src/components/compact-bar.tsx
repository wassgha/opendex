import { SpendingMeter } from "./spending-meter";
import { isVoiceFailureFeedback } from "@/lib/dex/realtime/voice-error";
import { InputTranscript } from "./input-transcript";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Circle, Square, Loader2, Maximize2, Settings, X } from "lucide-react";
import { useRecordingState } from "@/lib/recordings/use-recording-state";
import { Button } from "@/components/ui/button";
import { ToolCardLayer, latestToolCard } from "@skills/tool-card-layer";
import { getToolView } from "@skills/tool-registry";
import { MicrophoneVisual } from "./microphone-feedback";
import { awarenessLabel } from "@/lib/dex/state";
import { AwarenessIndicator } from "./status-bar";
import { TaskProgress } from "./task-progress";
import type { DexStatus } from "@/lib/dex/state";
import { cn } from "@/lib/utils";
import type { SessionToolInvocation } from "../../../main/ipc/channels";

// Notch sizing (px). The window stays screen-centered, so a fixed center gap
// always lands under the physical laptop notch and the two wings (flex-1, equal
// share) keep it centered at any width.
const NOTCH_GAP = 190; // reserved center gap ≈ physical notch width
const COMPACT_WIDTH = 340; // enough room for both controls around the physical notch
const WIDE_WIDTH = 420; // expanded for a caption / controls / type field
const BAR_H = 68; // controls (40), spending (24), bottom inset (4)
const CARD_H = 80; // body region for a tool-result card'
const MAX_CAPTION_H = 156; // bounded, scrollable transcript
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
  inputTranscript = "",
  inputInterim = false,
  voiceFeedback,
  toolInvocations,
  agentName,
  wakeWord,
  recovery,
  progress,
  isMuted,
  StatusIndicator,
  onSubmitText,
  onToggleMute,
  onDismissCards,
  onExpand,
  onOpenSettings,
}: {
  status: DexStatus;
  caption: string;
  inputTranscript?: string;
  inputInterim?: boolean;
  voiceFeedback?: string;
  toolInvocations: SessionToolInvocation[];
  agentName: string;
  wakeWord?: string;
  recovery?: ReactNode;
  progress?: { label: string; completed: number } | null;
  isMuted: boolean;
  /** The active theme's status indicator (defaults to StatusDot in NotchApp). */
  StatusIndicator: ComponentType<{ status: DexStatus }>;
  onSubmitText: (text: string) => void;
  onToggleMute: () => void;
  onDismissCards: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  // Reflect tentative speech visually without changing the actual tool/playback state.
  const indicatorStatus: DexStatus = voiceFeedback === "Speech detected" ? "active_listening"
    : voiceFeedback === "Understanding…" ? "thinking" : status;
  const voiceLabel = voiceFeedback || awarenessLabel(status, wakeWord);
  const voiceFailure = isVoiceFailureFeedback(voiceFeedback);
  const recording = useRecordingState();
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  useEffect(() => {
    // Electron can focus the first button when activating this window. Only
    // deliberate keyboard navigation should give the recorder a focus ring.
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Tab") setKeyboardNavigation(true); };
    const pointer = () => setKeyboardNavigation(false);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", pointer, true);
    window.addEventListener("blur", pointer);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("blur", pointer);
    };
  }, []);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState("");
  const recordingActive = recording.phase !== "idle";
  const toggleRecording = async () => {
    setRecordBusy(true); setRecordError("");
    try {
      const result = await window.opendex.recordingControl(recordingActive ? "stop" : "start");
      if (result.error) setRecordError(result.error);
    } catch (error) { setRecordError(String(error)); }
    finally { setRecordBusy(false); }
  };
  const recordingError = recordError || recording.error;
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
  const currentCard = latestToolCard(toolInvocations);
  const cardHeight = currentCard ? getToolView(currentCard.name).notchHeight ?? CARD_H : CARD_H;
  const hasCaption = caption.length > 0;
  const hasInput = Boolean(inputTranscript.trim()) &&
    (expanded || !["idle", "listening_wake", "muted"].includes(status));
  const inputRefContainer = useRef<HTMLDivElement>(null);
  const [inputHeight, setInputHeight] = useState(0);
  useEffect(() => {
    const element = inputRefContainer.current;
    if (!element) { setInputHeight(0); return; }
    const measure = () => setInputHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasInput]);
  const captionContentRef = useRef<HTMLDivElement>(null);
  const [captionHeight, setCaptionHeight] = useState(36);
  const previousCaption = useRef("");
  const [followVoice, setFollowVoice] = useState(true);
  const [captionScrolled, setCaptionScrolled] = useState(false);
  const captionLimit = expanded ? MAX_CAPTION_H : 84;
  const visibleCaptionHeight = Math.min(captionHeight, captionLimit);
  useEffect(() => {
    // Preserve the reader's position during streaming; start each new reply at
    // the top instead of inheriting the previous reply's scroll offset.
    if (!caption.startsWith(previousCaption.current)) {
      const viewport = captionContentRef.current?.parentElement;
      if (viewport) viewport.scrollTop = 0;
      setFollowVoice(true);
    }
    previousCaption.current = caption;
  }, [caption]);
  useEffect(() => {
    const viewport = captionContentRef.current?.parentElement;
    if (!viewport || !hasCaption || !followVoice) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previousTime = performance.now();
    const follow = (now: number) => {
      frame = 0;
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const distance = target - viewport.scrollTop;
      const elapsed = Math.min(64, now - previousTime);
      previousTime = now;
      // Follow a moving target without restarting a browser smooth-scroll for
      // every caption delta. Hover, resize and generation completion never pause it.
      viewport.scrollTop = reducedMotion.matches || Math.abs(distance) < 3
        ? target : viewport.scrollTop + distance * (1 - Math.exp(-elapsed / 75));
      if (Math.abs(target - viewport.scrollTop) < 3) viewport.scrollTop = target;
      else if (!reducedMotion.matches) frame = requestAnimationFrame(follow);
    };
    const schedule = () => {
      if (frame) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(follow);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(captionContentRef.current!);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [hasCaption, followVoice]);
  useEffect(() => {
    const content = captionContentRef.current;
    if (!content) return;
    const measure = () => setCaptionHeight(Math.min(MAX_CAPTION_H, content.offsetHeight + 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasCaption]);

  // Drive the host window. Width is two-tier (compact at rest, wide when there's
  // something to show) so the centered gap stays under the physical notch; height
  // grows downward for the card + type field. The window animates between sizes.
  const width = hasCard || hasCaption || hasInput || expanded || recovery || progress || voiceFailure ? WIDE_WIDTH : COMPACT_WIDTH;
  const height = BAR_H + (voiceFailure ? 64 : 0) + (hasInput ? inputHeight : 0) + (hasCaption && !followVoice ? 28 : 0) + (recordingError ? 44 : 0) + (progress ? 40 : 0) + (recovery ? 44 : 0) + (hasCard ? cardHeight : 0) + (hasCaption ? visibleCaptionHeight : 0) + (expanded ? TYPE_H : 0);
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
          <AwarenessIndicator status={indicatorStatus}><StatusIndicator status={indicatorStatus} /></AwarenessIndicator>
          <Button variant="ghost" size="icon-sm" onClick={() => void toggleRecording()}
            onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}
            disabled={recording.phase === "saving" || (recordBusy && !recordingActive)}
            aria-label={recording.phase === "saving" ? "Saving recording" : recordingActive ? "Stop recording" : "Start recording"}
            title={recordingActive ? "Stop recording" : "Record screen and audio"}
            className={cn("shrink-0 rounded-full cursor-pointer", !keyboardNavigation && "focus-visible:ring-0 focus-visible:ring-offset-0", recordingActive ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground")}>
            {recording.phase === "saving" || (recordBusy && !recordingActive) ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : recordingActive ? <Square className="fill-current size-3" /> : <Circle className="size-3" />}
          </Button>
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
                  aria-label={`${voiceLabel}. ${isMuted ? "Resume listening" : "Pause listening"}`}
                  title={`${voiceLabel}. Ring shows microphone input. Click to ${isMuted ? "resume" : "pause"}.`}
                  className={iconButton}
                >
                  <MicrophoneVisual status={status} isMuted={isMuted} />
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

      {voiceFailure ? (
        <div className="flex h-16 shrink-0 items-center gap-3 px-4 text-xs">
          <p role="status" className="min-w-0 flex-1 leading-4 text-foreground">{voiceLabel}</p>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onOpenSettings}>Settings</Button>
        </div>
      ) : <span className="sr-only" role="status">{voiceLabel}</span>}
      {recovery && <div className="shrink-0 px-3 pb-1">{recovery}</div>}

      {hasInput && (
        <div ref={inputRefContainer} className="min-w-0 shrink-0">
          <InputTranscript text={inputTranscript} interim={inputInterim} />
        </div>
      )}

      <TaskProgress progress={progress ?? null} />

      {/* Speech */}
      <AnimatePresence>
        {hasCaption && (
          <motion.div
            key="caption"
            className="min-w-0 shrink-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[13px] leading-[22px] text-foreground/90 px-4 py-2 whitespace-pre-wrap break-words select-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            style={{
              height: visibleCaptionHeight,
              // Fade only after older text has moved above the viewport; leave
              // the first line fully readable when reviewing from the beginning.
              maskImage: captionScrolled ? "linear-gradient(to bottom, transparent, black 24px)" : undefined,
              WebkitMaskImage: captionScrolled ? "linear-gradient(to bottom, transparent, black 24px)" : undefined,
            }}
            onWheel={event => { if (event.deltaY < 0) setFollowVoice(false); }}
            onTouchMove={() => setFollowVoice(false)}
            onKeyDown={event => {
              if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setFollowVoice(false);
              if (event.key === "End") setFollowVoice(true);
            }}
            onScroll={event => {
              const viewport = event.currentTarget;
              setCaptionScrolled(viewport.scrollTop > 1);
              if (!followVoice && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 4) setFollowVoice(true);
            }}
            tabIndex={0}
            role="region"
            aria-label="Conversation transcript"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div ref={captionContentRef}>{caption}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {hasCaption && !followVoice && (
        <button type="button" onClick={() => setFollowVoice(true)}
          className="h-7 shrink-0 self-end px-4 text-[11px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Follow voice ↓
        </button>
      )}

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
                onClick={onDismissCards}
                aria-label="Dismiss result"
                title="Dismiss result"
                className="absolute -right-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white"
              >
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SpendingMeter compact />

      {recordingError && <button type="button" onClick={() => { setRecordError(""); onOpenSettings(); }} role="alert" className="h-11 shrink-0 truncate px-3 text-xs text-destructive" title={recordingError}>{recordingError}</button>}
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
