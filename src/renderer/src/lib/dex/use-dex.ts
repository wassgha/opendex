import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRecognition,
  isSpeechRecognitionSupported,
  joinTranscript,
  type SpeechRecognitionInstance,
} from "./speech-recognition";
import { createSentenceBuffer } from "./sentence-buffer";
import {
  createSpeechEngine,
  SystemSpeechEngine,
  type SpeechEngine,
  type SpeechEngineKind,
  type SystemVoiceOptions,
} from "./speech-engine";
import { AudioMeter } from "./audio-meter";
import { vlog } from "./voice-timing";
import { CloudSttEngine } from "./engines/cloud-stt";
import type { SttEngine, WakeEngine } from "./engines/types";
import type { DexStatus, TranscriptTurn } from "./state";
import { formatToolCall } from "../format-tool-call";
import type { ToolCallEvent } from "../../../../main/ipc/channels";
import type { ChatMessage } from "../../../../main/agent/chat";
import type { SttProvider, WakeMode } from "../../../../main/config/schema";

export interface ModelLoadingState {
  active: boolean;
  label: string;
}

export interface ToolActivity {
  id: string;
  icon: string;
  label: string;
}

// How long a tool-activity banner lingers before fading out.
const TOOL_ACTIVITY_TTL_MS = 4000;

// Computer-use tools. When the agent starts driving the screen, we stop voicing
// its per-action narration (the user can watch the screen + the activity
// banners) and speak only the opening line and the final summary — otherwise
// TTS lags far behind the fast on-screen actions.
const COMPUTER_TOOL_NAMES = new Set([
  "captureScreen",
  "click",
  "moveMouse",
  "drag",
  "typeText",
  "pressKeys",
  "scroll",
  "wait",
]);

// A smooth, organic synthetic loudness envelope (0..1) used for speaking/
// thinking states where we don't meter the actual audio. Layered sines give it
// life without looking like a pure sine wave.
function syntheticEnvelope(intensity: number): number {
  const t = performance.now() / 1000;
  const v =
    Math.sin(t * 7.0) * 0.5 +
    Math.sin(t * 11.3 + 1.1) * 0.3 +
    Math.sin(t * 17.7 + 2.3) * 0.2;
  return Math.max(0, Math.min(1, 0.55 + v * 0.45)) * intensity;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWakeRegex(word: string): RegExp {
  const cleaned = word.trim() || "dex";
  return new RegExp(`\\b${escapeRegExp(cleaned)}\\b`, "i");
}

// Trailing silence (after speech is heard) that ends an utterance so we can
// transcribe and act. Kept short — this is the main lever on the gap between
// "user stopped talking" and "assistant starts". A natural between-word pause
// is well under this.
const END_SILENCE_MS = 1000;
// How long to wait for the user to *start* speaking before giving up quietly.
// Longer for follow-ups (the user may take a beat before continuing).
const COMMAND_NO_SPEECH_MS = 6000;
const FOLLOW_UP_NO_SPEECH_MS = 10000;
const COMMAND_HARD_TIMEOUT_MS = 15000;
// After TTS finishes we wait this long before resuming listening, to give
// speaker output time to flush and the browser's AEC chain to settle.
const POST_TTS_COOLDOWN_MS = 800;
// During the first window of follow-up listening, transcripts whose words
// mostly match the just-finished assistant reply are treated as echo and
// dropped, regardless of confidence.
const FOLLOW_UP_ECHO_WINDOW_MS = 4500;
const FOLLOW_UP_ECHO_REJECT_RATIO = 0.45;
// Barge-in (interrupting the assistant while it speaks) is opt-in. Without proper
// hardware AEC, listening while audio plays produces echo-induced loops.
const BARGE_COOLDOWN_MS = 1200;
const BARGE_MIN_CHARS = 16;
const BARGE_NEW_WORD_RATIO = 0.8;

type Mode = "off" | "wake" | "command" | "follow_up";

interface RunningCommand {
  abortController: AbortController;
  getPartialReply: () => string;
}

export interface UseDexOptions {
  /** Wake word that triggers active listening (Web Speech wake mode). */
  wakeWord: string;
  /** How active listening is triggered. */
  wakeMode: WakeMode;
  /** Built-in Porcupine keyword id (porcupine wake mode). */
  porcupineKeyword: string;
  /** Which engine transcribes captured commands. */
  sttProvider: SttProvider;
  /** transformers.js Whisper model id (local STT). */
  whisperModel: string;
  /** Whether a proactive greeting fires on the first wake. */
  greetingEnabled: boolean;
  /** Which speech engine to use for spoken output. */
  ttsEngine: SpeechEngineKind;
  /** System-TTS voice settings (used when ttsEngine === "system"). */
  systemVoice: SystemVoiceOptions;
}

export interface UseDexResult {
  status: DexStatus;
  transcript: TranscriptTurn[];
  liveCaption: string;
  /** Assistant text spoken so far this turn (lags the token stream; for
   *  speech-synced display). */
  spokenCaption: string;
  isMuted: boolean;
  audioBlocked: boolean;
  bargeInEnabled: boolean;
  briefingActive: boolean;
  /** Local model download/load progress (Whisper / Vosk). */
  loadingModel: ModelLoadingState;
  /** True when the user can tap/hotkey to talk (manual wake mode, idle). */
  canPushToTalk: boolean;
  pushToTalk: () => void;
  /** Submit a typed command through the same agent path as a spoken one. */
  submitText: (text: string) => void;
  /** Abort whatever the agent is currently doing (mid-reply or mid tool loop). */
  interrupt: () => void;
  /** Recent tool calls the agent made (transient; for the activity banners). */
  toolActivity: ToolActivity[];
  /** Current voice loudness, 0..1 — real mic level while listening, a synthetic
   *  envelope while speaking/thinking. Sampled by the visualization via rAF. */
  getAmplitude: () => number;
  unlockAudio: () => void;
  stop: () => void;
  toggleMute: () => void;
  toggleBargeIn: () => void;
}

export function useDex(options: UseDexOptions): UseDexResult {
  // Latest options, readable from event handlers without re-binding them.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [status, setStatus] = useState<DexStatus>("idle");
  // Mirror of status for rAF-driven reads (getAmplitude) without re-binding.
  const statusRef = useRef<DexStatus>("idle");
  statusRef.current = status;
  const meterRef = useRef<AudioMeter | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  // The assistant text *spoken so far* this turn. Tracks TTS playback (which lags
  // the model's faster token stream) so UIs can show speech-synced text instead
  // of racing ahead. Replaced on the first spoken chunk of a new turn (not at
  // turn start) so the previous reply stays on screen during the thinking gap.
  const [spokenCaption, setSpokenCaption] = useState("");
  const spokenFreshRef = useRef(true);
  const [isMuted, setIsMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [bargeInEnabled, setBargeInEnabled] = useState(false);
  const [briefingActive, setBriefingActive] = useState(false);
  const [loadingModel, setLoadingModel] = useState<ModelLoadingState>({
    active: false,
    label: "",
  });
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const toolTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const addToolActivity = useCallback((call: ToolCallEvent) => {
    const { icon, label } = formatToolCall(call);
    const id = `${call.toolCallId}-${Math.random().toString(36).slice(2, 6)}`;
    setToolActivity((prev) => [...prev, { id, icon, label }]);
    const timer = setTimeout(() => {
      setToolActivity((prev) => prev.filter((t) => t.id !== id));
      toolTimersRef.current.delete(timer);
    }, TOOL_ACTIVITY_TTL_MS);
    toolTimersRef.current.add(timer);
  }, []);

  const clearToolActivity = useCallback(() => {
    toolTimersRef.current.forEach(clearTimeout);
    toolTimersRef.current.clear();
    setToolActivity([]);
  }, []);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const bargeRef = useRef<SpeechRecognitionInstance | null>(null);
  // Phase 4 engines (instantiated only for their respective modes).
  const wakeEngineRef = useRef<WakeEngine | null>(null);
  const sttEngineRef = useRef<{ provider: SttProvider; engine: SttEngine } | null>(null);
  const sttAbortRef = useRef<AbortController | null>(null);
  const modeRef = useRef<Mode>("off");
  const ttsRef = useRef<SpeechEngine | null>(null);
  // Full conversation history sent to the model — ModelMessages so tool calls +
  // results persist across turns (prevents the agent re-running prior actions).
  const messagesRef = useRef<ChatMessage[]>([]);
  const runningCommandRef = useRef<RunningCommand | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartGuardRef = useRef(false);
  const mutedRef = useRef(false);
  const startedRef = useRef(false);
  const hasBriefedRef = useRef(false);
  const bargeInEnabledRef = useRef(false);
  // Consecutive wake-recognition network failures. The Web Speech API depends
  // on a remote service that is unavailable in packaged Electron; rather than
  // hammer it in a tight restart loop, we back off and bail to "unsupported"
  // after a few failures. (Replaced by local wake/STT engines in Phase 4.)
  const wakeNetworkFailuresRef = useRef(0);
  const WAKE_MAX_NETWORK_FAILURES = 4;
  // Persistent mic stream held for the lifetime of the session. Keeping a
  // getUserMedia track active with AEC constraints keeps the browser's echo
  // cancellation pipeline warm — improving reliability for the SpeechRecognition
  // capture which uses its own internal track.
  const micStreamRef = useRef<MediaStream | null>(null);
  // Words spoken by the assistant in the current reply — used as the echo
  // filter for both the barge-in monitor and the follow-up listening window.
  const assistantWordsRef = useRef<Set<string>>(new Set());
  const bargeTriggeredRef = useRef(false);

  // Web Speech is only required when it's the chosen wake or STT backend.
  const needsWebSpeech =
    options.wakeMode === "webspeech" || options.sttProvider === "webspeech";
  useEffect(() => {
    if (needsWebSpeech && !isSpeechRecognitionSupported()) setStatus("unsupported");
  }, [needsWebSpeech]);

  const appendTurn = useCallback(
    (role: TranscriptTurn["role"], content: string) => {
      const turn: TranscriptTurn = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
      };
      setTranscript((prev) => [...prev, turn]);
      return turn.id;
    },
    [],
  );

  const updateLastAssistant = useCallback((content: string) => {
    setTranscript((prev) => {
      if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content,
          },
        ];
      }
      const next = prev.slice();
      next[next.length - 1] = { ...next[next.length - 1], content };
      return next;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
  }, []);

  // Forward-declared callable so runCommand can re-enter startMode.
  const startModeRef = useRef<((mode: Mode) => void) | null>(null);

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.onspeechend = null;
    try {
      rec.abort();
    } catch {
      // ignore — already stopped
    }
    recognitionRef.current = null;
  }, []);

  const stopWakeEngine = useCallback(() => {
    const engine = wakeEngineRef.current;
    wakeEngineRef.current = null;
    void engine?.dispose();
  }, []);

  // Lazily create (and cache) the STT engine for the configured provider.
  // Local engines are dynamic-imported so their WASM only loads when chosen.
  const ensureSttEngine = useCallback(
    async (provider: SttProvider, whisperModel: string): Promise<SttEngine> => {
      if (sttEngineRef.current?.provider === provider) {
        return sttEngineRef.current.engine;
      }
      sttEngineRef.current?.engine.dispose();
      let engine: SttEngine;
      if (provider === "openai") {
        engine = new CloudSttEngine("openai");
      } else if (provider === "whisper-local") {
        const { WhisperSttEngine } = await import("./engines/whisper-stt");
        engine = new WhisperSttEngine(whisperModel, (p) =>
          setLoadingModel({ active: p.progress < 100, label: p.label }),
        );
        void engine.preload?.();
      } else if (provider === "vosk-local") {
        const { VoskSttEngine } = await import("./engines/vosk-stt");
        engine = new VoskSttEngine(undefined, (loading) =>
          setLoadingModel({ active: loading, label: "Loading voice model…" }),
        );
        void engine.preload?.();
      } else {
        throw new Error(`Unknown cloud/local STT provider: ${provider}`);
      }
      sttEngineRef.current = { provider, engine };
      return engine;
    },
    [],
  );

  const abortStt = useCallback(() => {
    sttAbortRef.current?.abort();
    sttAbortRef.current = null;
  }, []);

  const stopBargeMonitor = useCallback(() => {
    const rec = bargeRef.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // ignore
    }
    bargeRef.current = null;
  }, []);

  const startBargeMonitor = useCallback(
    (onBarge: (text: string) => void) => {
      stopBargeMonitor();
      const rec = createRecognition({
        continuous: true,
        interimResults: true,
        lang: "en-US",
      });
      if (!rec) return;
      bargeRef.current = rec;
      bargeTriggeredRef.current = false;
      const startedAt = Date.now();

      rec.onresult = (event) => {
        if (bargeTriggeredRef.current) return;
        if (Date.now() - startedAt < BARGE_COOLDOWN_MS) return;
        const { finalText, interimText } = joinTranscript(event.results);
        const heard = (finalText + " " + interimText).trim();
        if (heard.length < BARGE_MIN_CHARS) return;

        // Echo filter: reject heard text where most words appear in
        // the assistant's own recent reply.
        const heardWords = heard
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);
        if (heardWords.length === 0) return;
        const newWordCount = heardWords.filter(
          (w) => !assistantWordsRef.current.has(w),
        ).length;
        const newRatio = newWordCount / heardWords.length;
        if (newRatio < BARGE_NEW_WORD_RATIO) return;

        bargeTriggeredRef.current = true;
        stopBargeMonitor();
        onBarge(heard);
      };
      rec.onerror = () => {
        // 'no-speech', 'aborted' — silently let onend handle restart
      };
      rec.onend = () => {
        if (bargeRef.current === rec && !bargeTriggeredRef.current) {
          try {
            rec.start();
          } catch {
            // give up — speaking state will tear this down soon anyway
          }
        }
      };
      try {
        rec.start();
      } catch (err) {
        console.error("[opendex] failed to start barge monitor", err);
      }
    },
    [stopBargeMonitor],
  );

  const runCommand = useCallback(
    async (userText: string, opts?: { mode?: "briefing"; resumeMode?: Mode }) => {
      const isBriefing = opts?.mode === "briefing";
      vlog("runCommand:start", { chars: userText.length, briefing: isBriefing });
      // Next spoken chunk replaces the (now-stale) spoken caption rather than
      // appending — but we leave the prior reply on screen until then.
      spokenFreshRef.current = true;
      // The briefing is proactive — we don't show the synthetic prompt as a
      // user turn, but we still record it for conversational continuity.
      if (!isBriefing) appendTurn("user", userText);
      setLiveCaption("");
      setStatus("thinking");
      if (isBriefing) setBriefingActive(true);

      messagesRef.current.push({ role: "user", content: userText });

      const tts = ttsRef.current!;
      let loggedFirstTts = false;
      // Muting disables speech *output* as well as input — a typed command run
      // while on standby shows in the transcript but is never voiced.
      const speak = (text: string) => {
        if (mutedRef.current) return;
        if (!loggedFirstTts) {
          loggedFirstTts = true;
          vlog("tts:first-enqueue");
        }
        tts.enqueue(text);
      };
      const buffer = createSentenceBuffer();
      const abortController = new AbortController();
      let assistantText = "";
      // Computer-use "quiet mode": once the agent acts on the screen, the model
      // can emit narration faster than it can be spoken. Rather than mute it or
      // let it pile up (lagging behind the actions), we voice a note only when
      // TTS has caught up, always keeping the *freshest* unspoken sentence as
      // `pending` and dropping stale ones — so spoken updates stay current.
      let quiet = false;
      let pending: string | null = null;
      runningCommandRef.current = {
        abortController,
        getPartialReply: () => assistantText,
      };

      // Reset the assistant-word filter for the new reply.
      assistantWordsRef.current = new Set();

      // Start barge-in monitor as soon as TTS begins. We arm it here once;
      // the first audio clip will trigger speaking → monitor starts.
      const handleBarge = (heardText: string) => {
        // Save partial reply if any, then run a new command with the heard text.
        const partial = assistantText.trim();
        if (partial) {
          messagesRef.current.push({ role: "assistant", content: partial });
        }
        tts.stop();
        abortController.abort();
        runningCommandRef.current = null;
        stopBargeMonitor();
        // Kick off the new turn.
        void runCommand(heardText);
      };

      // Only arm the barge monitor if the user has opted into interruption.
      // Without proper hardware AEC, listening while the assistant speaks produces
      // self-triggered loops.
      if (bargeInEnabledRef.current) {
        bargeOnSpeakingRef.current = () => startBargeMonitor(handleBarge);
      } else {
        bargeOnSpeakingRef.current = null;
      }

      let bargedIn = false;
      let loggedFirstToken = false;
      let loggedFirstTool = false;
      try {
        // Stream the reply from the main process over IPC. Each delta feeds the
        // sentence buffer (→ TTS) and the live transcript, exactly as the old
        // HTTP stream did.
        const chatHandle = window.opendex.chat({
          messages: messagesRef.current,
          mode: isBriefing ? "briefing" : undefined,
          onToolCall: (call) => {
            if (!loggedFirstTool) {
              loggedFirstTool = true;
              vlog("tool:first", { tool: call.toolName });
            }
            addToolActivity(call);
            // First on-screen action: flush the opener to TTS, then go quiet.
            if (COMPUTER_TOOL_NAMES.has(call.toolName) && !quiet) {
              for (const tail of buffer.flush()) speak(tail);
              quiet = true;
            }
          },
          onDelta: (value) => {
            if (!value) return;
            if (!loggedFirstToken) {
              loggedFirstToken = true;
              vlog("model:first-token");
            }
            assistantText += value;
            updateLastAssistant(assistantText);
            // Refresh the echo-filter word set as new text arrives.
            for (const w of value.toLowerCase().split(/\s+/)) {
              if (w.length > 3) assistantWordsRef.current.add(w);
            }
            for (const chunk of buffer.push(value)) {
              if (!quiet) {
                speak(chunk);
              } else if (!tts.isSpeaking) {
                // Caught up — voice this note now and forget any stale one.
                speak(chunk);
                pending = null;
              } else {
                // Still speaking — hold only the freshest note, drop older.
                pending = chunk;
              }
            }
          },
        });

        // Bridge the existing AbortController (driven by barge-in and stop()) to
        // the IPC stream's cancel.
        if (abortController.signal.aborted) {
          chatHandle.cancel();
        } else {
          abortController.signal.addEventListener(
            "abort",
            () => chatHandle.cancel(),
            { once: true },
          );
        }

        const respMessages = await chatHandle.done;

        if (abortController.signal.aborted) {
          // Cancelled by barge-in or stop — skip the drain/follow-up transition.
          bargedIn = true;
        } else {
          if (quiet) {
            // Voice the freshest unspoken note plus any trailing summary, so the
            // wrap-up always lands even if TTS was busy through the last action.
            const tail = [pending, ...buffer.flush()].filter(Boolean).join(" ").trim();
            if (tail) speak(tail);
          } else {
            for (const tail of buffer.flush()) speak(tail);
          }
          // Record the real assistant + tool messages so the model remembers
          // what it already did (and won't re-trigger gated actions next turn).
          if (respMessages.length) messagesRef.current.push(...respMessages);
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          bargedIn = true;
        } else {
          console.error("[opendex] chat error", err);
          setStatus("error");
          setBriefingActive(false);
          stopBargeMonitor();
          bargeOnSpeakingRef.current = null;
          runningCommandRef.current = null;
          return;
        }
      }
      // NB: we intentionally do NOT release runningCommandRef here. The turn
      // isn't over until TTS finishes draining below, and interrupt()/Stop must
      // have a command to abort during the "speaking" phase (when the stream is
      // already done but audio is still playing).

      if (bargedIn) {
        // Barge handler has already kicked off the next runCommand call.
        return;
      }

      // Wait for the TTS queue to drain, then transition to follow-up listening
      // after a short cooldown that lets the speaker output fully flush so the
      // mic doesn't pick up the tail of the assistant's own voice.
      const waitForDrain = () =>
        new Promise<void>((resolve) => {
          const check = () => {
            if (!tts.isSpeaking) return resolve();
            setTimeout(check, 120);
          };
          check();
        });
      await waitForDrain();

      stopBargeMonitor();
      bargeOnSpeakingRef.current = null;
      if (isBriefing) setBriefingActive(false);

      await new Promise((r) => setTimeout(r, POST_TTS_COOLDOWN_MS));

      // Turn fully complete — release the slot (unless a newer command already
      // took it, e.g. via barge-in or a typed command).
      if (runningCommandRef.current?.abortController === abortController) {
        runningCommandRef.current = null;
      }

      // Interrupted during streaming or the drain phase (Stop / mute / stop()):
      // those handlers have already set the target status, so don't resume.
      if (abortController.signal.aborted) return;

      if (mutedRef.current) {
        setStatus("muted");
      } else {
        // Typed turns resume in passive wake mode (so we don't actively capture
        // ambient noise as a command); spoken turns flow into follow-up listening.
        startModeRef.current?.(opts?.resumeMode ?? "follow_up");
      }
    },
    [
      addToolActivity,
      appendTurn,
      startBargeMonitor,
      stopBargeMonitor,
      updateLastAssistant,
    ],
  );

  // Hook between TtsPlayer's "speaking" transition and the barge monitor start.
  const bargeOnSpeakingRef = useRef<(() => void) | null>(null);

  const startMode = useCallback(
    (mode: Mode) => {
      stopRecognition();
      stopWakeEngine();
      abortStt();
      clearTimers();

      // Hard standby guard. A wake event that fired just before mute (vosk match,
      // a queued Web Speech onresult, an awaiting porcupine start) runs its
      // callback *after* mute tore everything down and re-enters startMode. While
      // muted, refuse to (re)engage anything and pin the UI to "muted". Unmute
      // clears mutedRef before calling startMode, so it's unaffected.
      if (mutedRef.current && mode !== "off") {
        modeRef.current = "off";
        setStatus("muted");
        return;
      }
      modeRef.current = mode;

      if (mode === "off") {
        setStatus(mutedRef.current ? "muted" : "idle");
        return;
      }

      const opts = optionsRef.current;

      // ---- Wake ----
      if (mode === "wake") {
        setStatus("listening_wake");
        setLiveCaption("");

        // Warm a local STT model now so the first capture isn't blocked on a
        // (potentially large) one-time download.
        if (
          opts.sttProvider === "whisper-local" ||
          opts.sttProvider === "vosk-local"
        ) {
          void ensureSttEngine(opts.sttProvider, opts.whisperModel).catch(() => {});
        }

        // Fire the proactive greeting on first wake (if enabled), else listen
        // for a command.
        const onWake = () => {
          // A wake detection queued just before mute can fire after the engine
          // was torn down. Ignore it so voice never re-engages while on standby.
          if (mutedRef.current) return;
          if (!hasBriefedRef.current && opts.greetingEnabled) {
            hasBriefedRef.current = true;
            void runCommand("Give me my briefing.", { mode: "briefing" });
          } else {
            startModeRef.current?.("command");
          }
        };

        if (opts.wakeMode === "manual") {
          // No continuous listening — wait for pushToTalk(). Still deliver the
          // first greeting proactively so manual users get the briefing.
          if (!hasBriefedRef.current && opts.greetingEnabled) {
            hasBriefedRef.current = true;
            void runCommand("Give me my briefing.", { mode: "briefing" });
          }
          return;
        }

        if (opts.wakeMode === "porcupine") {
          void (async () => {
            // Code-split: the Porcupine WASM (~4MB) loads only in this mode.
            const { PorcupineWakeEngine } = await import("./engines/porcupine-wake");
            const key = await window.opendex.getPicovoiceKey();
            if (modeRef.current !== "wake") return; // mode changed while loading
            const engine = new PorcupineWakeEngine(
              key,
              opts.porcupineKeyword,
              (s) => {
                if (s !== "ok") setStatus("unsupported");
              },
            );
            wakeEngineRef.current = engine;
            await engine.start(onWake);
          })();
          return;
        }

        if (opts.wakeMode === "vosk") {
          void (async () => {
            // Code-split: the Vosk WASM loads only in this mode.
            const { VoskWakeEngine } = await import("./engines/vosk-wake");
            if (modeRef.current !== "wake") return;
            const engine = new VoskWakeEngine(
              opts.wakeWord,
              undefined,
              (s) => {
                if (s !== "ok") setStatus("unsupported");
              },
              (loading) =>
                setLoadingModel({ active: loading, label: "Loading wake model…" }),
            );
            wakeEngineRef.current = engine;
            await engine.start(onWake);
          })();
          return;
        }

        // wakeMode === "webspeech": continuous recognition scanning for the word.
        const rec = createRecognition({
          continuous: true,
          interimResults: true,
          lang: "en-US",
        });
        if (!rec) {
          setStatus("unsupported");
          return;
        }
        recognitionRef.current = rec;
        let resultBaseline = 0;
        rec.onresult = (event) => {
          if (mutedRef.current) return; // ignore late results while on standby
          const { finalText, interimText } = joinTranscript(
            event.results,
            resultBaseline,
          );
          const combined = `${finalText} ${interimText}`.trim();
          // Any successful result means the engine is reachable — reset the
          // failure backoff.
          wakeNetworkFailuresRef.current = 0;
          const match = combined.match(buildWakeRegex(optionsRef.current.wakeWord));
          if (match && match.index !== undefined) {
            const trailing = combined.slice(match.index + match[0].length).trim();
            resultBaseline = event.results.length;
            // The first time the operator wakes the assistant, deliver the
            // proactive greeting (if enabled) instead of listening for a command.
            if (!hasBriefedRef.current && optionsRef.current.greetingEnabled) {
              hasBriefedRef.current = true;
              stopRecognition();
              void runCommand("Give me my briefing.", { mode: "briefing" });
            } else if (trailing.length >= 3) {
              stopRecognition();
              void runCommand(trailing);
            } else {
              startModeRef.current?.("command");
            }
          }
        };
        rec.onerror = (event) => {
          if (event.error === "not-allowed") {
            setStatus("error");
            return;
          }
          // Remote-service failures (unavailable in packaged Electron): count
          // them so onend can back off / bail instead of looping tightly.
          if (
            event.error === "network" ||
            event.error === "service-not-allowed"
          ) {
            wakeNetworkFailuresRef.current += 1;
          }
        };
        rec.onend = () => {
          if (
            modeRef.current !== "wake" ||
            restartGuardRef.current ||
            mutedRef.current
          ) {
            return;
          }
          // The wake engine is unreachable — stop hammering it and surface that
          // voice isn't available yet (local engines arrive in Phase 4).
          if (wakeNetworkFailuresRef.current >= WAKE_MAX_NETWORK_FAILURES) {
            stopRecognition();
            setStatus("unsupported");
            return;
          }
          // Back off proportionally to recent failures (immediate when healthy).
          const backoff = wakeNetworkFailuresRef.current * 600;
          if (backoff === 0) {
            try {
              rec.start();
              return;
            } catch {
              // fall through to delayed restart
            }
          }
          setTimeout(() => {
            if (modeRef.current === "wake" && !mutedRef.current) {
              startModeRef.current?.("wake");
            }
          }, backoff || 250);
        };
        try {
          rec.start();
        } catch (err) {
          console.error("[opendex] failed to start wake recognition", err);
        }
        return;
      }

      // ---- Command / follow-up capture ----
      setStatus(mode === "follow_up" ? "follow_up_listening" : "active_listening");
      setLiveCaption("");
      const noSpeechMs =
        mode === "follow_up" ? FOLLOW_UP_NO_SPEECH_MS : COMMAND_NO_SPEECH_MS;
      vlog("capture:start", {
        mode,
        provider: opts.sttProvider,
        endSilenceMs: END_SILENCE_MS,
        noSpeechMs,
      });

      // Cloud / local STT: capture an utterance via the chosen engine, then run
      // it. (openai = main-process Whisper; whisper-local / vosk-local = offline
      // WASM in the renderer.)
      if (opts.sttProvider !== "webspeech") {
        const ac = new AbortController();
        sttAbortRef.current = ac;
        void (async () => {
          try {
            const engine = await ensureSttEngine(opts.sttProvider, opts.whisperModel);
            if (ac.signal.aborted) return;
            const text = await engine.capture({
              silenceMs: END_SILENCE_MS,
              noSpeechMs,
              hardTimeoutMs: COMMAND_HARD_TIMEOUT_MS,
              signal: ac.signal,
            });
            if (ac.signal.aborted) return;
            const cleaned = text.trim();
            // Empty, or no real words (Whisper can hallucinate "." / "♪" from
            // noise) → ignore and go back to waiting.
            if (!cleaned || !/[a-z0-9]/i.test(cleaned)) {
              startModeRef.current?.("wake");
              return;
            }
            // Echo guard for follow-ups: drop a transcript that's mostly the
            // assistant's just-spoken words leaking back through the mic.
            if (mode === "follow_up" && assistantWordsRef.current.size > 0) {
              const words = cleaned
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 3);
              if (words.length > 0) {
                const newRatio =
                  words.filter((w) => !assistantWordsRef.current.has(w)).length /
                  words.length;
                if (newRatio < FOLLOW_UP_ECHO_REJECT_RATIO) {
                  startModeRef.current?.("wake");
                  return;
                }
              }
            }
            void runCommand(cleaned);
          } catch (err) {
            if (ac.signal.aborted) return;
            console.error("[opendex] stt error", err);
            startModeRef.current?.("wake");
          }
        })();
        return;
      }

      // sttProvider === "webspeech": single-shot recognition.
      const rec = createRecognition({
        continuous: false,
        interimResults: true,
        lang: "en-US",
      });
      if (!rec) {
        setStatus("unsupported");
        return;
      }
      recognitionRef.current = rec;
      const startedAt = Date.now();
      let finalTranscript = "";
      let heardAnything = false;
      let resolved = false;
      const settle = (text: string, fromTimeout = false) => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        stopRecognition();
        const cleaned = text.trim();
        vlog("endpoint:webspeech", {
          fromTimeout,
          captureMs: Date.now() - startedAt,
          chars: cleaned.length,
        });
        if (cleaned.length === 0) {
          // Nothing heard. Follow-up rolls back to wake; command does the same.
          if (fromTimeout && mode === "follow_up") {
            startModeRef.current?.("wake");
          } else {
            startModeRef.current?.("wake");
          }
        } else {
          void runCommand(cleaned);
        }
      };

      hardTimerRef.current = setTimeout(
        () => settle(finalTranscript, true),
        COMMAND_HARD_TIMEOUT_MS,
      );

      // Before any speech, wait the (longer) no-speech window for the user to
      // start; once we've heard something, end on the short trailing silence so
      // execution starts promptly.
      const resetSilenceTimer = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(
          () => settle(finalTranscript, true),
          heardAnything ? END_SILENCE_MS : noSpeechMs,
        );
      };
      resetSilenceTimer();

      rec.onresult = (event) => {
        const { finalText, interimText } = joinTranscript(event.results);
        const live = interimText || finalText;

        // Echo guard: within the early window of follow-up listening, drop
        // transcripts that look like the tail of the assistant's reply leaking through
        // the mic. We compare against the just-finished assistant words.
        if (
          mode === "follow_up" &&
          live.length > 6 &&
          Date.now() - startedAt < FOLLOW_UP_ECHO_WINDOW_MS &&
          assistantWordsRef.current.size > 0
        ) {
          const words = live
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3);
          if (words.length > 0) {
            const newCount = words.filter(
              (w) => !assistantWordsRef.current.has(w),
            ).length;
            const newRatio = newCount / words.length;
            if (newRatio < FOLLOW_UP_ECHO_REJECT_RATIO) {
              // Looks like an echo — drop without resetting the silence timer.
              // If silence persists, we'll fall back to wake mode normally.
              setLiveCaption("");
              return;
            }
          }
        }

        finalTranscript = finalText;
        if (live) heardAnything = true;
        setLiveCaption(live);
        resetSilenceTimer();
      };
      rec.onspeechend = () => {
        setTimeout(() => settle(finalTranscript), 600);
      };
      rec.onend = () => {
        if (!resolved) settle(finalTranscript);
      };
      rec.onerror = (event) => {
        if (event.error === "no-speech") {
          // For follow-up, "no-speech" before any audio just means the user
          // hasn't spoken — fall back to wake mode rather than treating it
          // as a real silence event.
          if (!heardAnything) {
            settle("", true);
          } else {
            settle(finalTranscript);
          }
          return;
        }
        if (event.error === "not-allowed") {
          setStatus("error");
          resolved = true;
          return;
        }
        // Web Speech reaches a remote service that's unavailable in Electron
        // (logs "OnSizeReceived failed -2"). Don't fail silently — surface that
        // transcription needs switching to a cloud provider.
        if (event.error === "network" || event.error === "service-not-allowed") {
          resolved = true;
          clearTimers();
          stopRecognition();
          setStatus("unsupported");
          return;
        }
      };

      try {
        rec.start();
      } catch (err) {
        console.error("[opendex] failed to start command recognition", err);
      }
    },
    [abortStt, clearTimers, ensureSttEngine, runCommand, stopWakeEngine, stopRecognition],
  );

  startModeRef.current = startMode;

  // Manual push-to-talk: jump straight to command capture (orb click / hotkey).
  const pushToTalk = useCallback(() => {
    if (optionsRef.current.wakeMode !== "manual" || mutedRef.current) return;
    const s = statusRef.current;
    if (s === "listening_wake" || s === "idle") {
      startModeRef.current?.("command");
    }
  }, []);

  const ttsKindRef = useRef<SpeechEngineKind | null>(null);
  const ensureTts = useCallback(() => {
    const { ttsEngine, systemVoice } = optionsRef.current;
    // Recreate the engine if the configured kind changed (e.g. via settings).
    if (ttsRef.current && ttsKindRef.current !== ttsEngine) {
      ttsRef.current.stop();
      ttsRef.current = null;
    }
    if (!ttsRef.current) {
      ttsRef.current = createSpeechEngine({
        kind: ttsEngine,
        system: systemVoice,
        callbacks: {
          onStateChange: (speaking) => {
            if (speaking) {
              setStatus("speaking");
              bargeOnSpeakingRef.current?.();
            }
            // The "speaking=false" transition is handled in runCommand's
            // waitForDrain, which is responsible for the next status.
          },
          onAudioBlocked: () => setAudioBlocked(true),
          onChunkStart: (text) => {
            setSpokenCaption((prev) => {
              if (spokenFreshRef.current) {
                spokenFreshRef.current = false;
                return text;
              }
              return prev ? `${prev} ${text}` : text;
            });
          },
        },
      });
      ttsKindRef.current = ttsEngine;
    } else if (ttsEngine === "system" && ttsRef.current instanceof SystemSpeechEngine) {
      // Engine kept across the session — push any updated voice/rate/pitch so a
      // settings change applies on the next utterance without a restart.
      ttsRef.current.setOptions(systemVoice);
    }
    return ttsRef.current;
  }, []);

  // ---- Live settings reconciliation ----
  // The voice engines are built once per session (at engage) and several capture
  // their settings at construction. Without these effects, changing a voice,
  // model, or wake word in settings would only take effect after a restart.

  // Output: rebuild on engine-kind change, otherwise push new voice settings.
  // Only touches an already-created engine (engage() owns lazy creation).
  useEffect(() => {
    if (ttsRef.current) ensureTts();
  }, [
    options.ttsEngine,
    options.systemVoice.voiceURI,
    options.systemVoice.rate,
    options.systemVoice.pitch,
    ensureTts,
  ]);

  // Input (STT): drop the cached engine so the next capture rebuilds with the new
  // provider/model. ensureSttEngine caches by provider alone, so a model swap on
  // the same provider would otherwise be ignored. Abort any in-flight capture
  // first so we don't dispose an engine it's still using, then re-arm wake (which
  // also preloads local models) if we're passively waiting.
  useEffect(() => {
    if (!startedRef.current) return;
    const wasCapturing = sttAbortRef.current !== null;
    abortStt();
    sttEngineRef.current?.engine.dispose();
    sttEngineRef.current = null;
    // Re-arm passive wake so the new engine preloads. If we aborted an in-flight
    // capture, fall back to wake too — the aborted capture won't re-arm itself.
    if (!mutedRef.current && (modeRef.current === "wake" || wasCapturing)) {
      startModeRef.current?.("wake");
    }
  }, [options.sttProvider, options.whisperModel, abortStt]);

  // Wake: Vosk/Porcupine capture their keyword at construction. If we're sitting
  // in passive wake, restart so the new wake engine takes over. Don't interrupt
  // an in-flight command or reply.
  useEffect(() => {
    if (!startedRef.current) return;
    const s = statusRef.current;
    if (
      modeRef.current === "wake" &&
      !mutedRef.current &&
      (s === "listening_wake" || s === "idle")
    ) {
      startModeRef.current?.("wake");
    }
  }, [options.wakeMode, options.wakeWord, options.porcupineKeyword]);

  const engage = useCallback(async () => {
    if (!isSpeechRecognitionSupported()) {
      setStatus("unsupported");
      return;
    }
    if (!micStreamRef.current) {
      try {
        // Hold the stream open for the lifetime of the session. Keeping a
        // track with AEC constraints active maximises the chance that the
        // browser applies echo cancellation to the SpeechRecognition capture.
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        console.error("[opendex] mic permission denied", err);
        setStatus("error");
        return;
      }
    }
    // Meter the mic so visualizations react to the user's voice while listening.
    if (!meterRef.current) meterRef.current = new AudioMeter();
    meterRef.current.attachMicStream(micStreamRef.current);
    ensureTts();
    mutedRef.current = false;
    setIsMuted(false);
    startMode("wake");
  }, [ensureTts, startMode]);

  // Typed input — an alternative to voice (e.g. when you can't speak). Runs the
  // text through the same agent path as a spoken command. If a reply is in
  // flight it interrupts it (preserving the partial for context, like a
  // barge-in); otherwise it tears down any active listening so the mic doesn't
  // also fire. Works even when voice is unsupported or audio was never engaged.
  const submitText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || statusRef.current === "error") return;

      restartGuardRef.current = true;
      clearTimers();
      stopRecognition();
      stopWakeEngine();
      abortStt();
      stopBargeMonitor();
      restartGuardRef.current = false;

      const running = runningCommandRef.current;
      if (running) {
        const partial = running.getPartialReply().trim();
        if (partial) messagesRef.current.push({ role: "assistant", content: partial });
        ttsRef.current?.stop();
        running.abortController.abort();
        runningCommandRef.current = null;
      }

      // Make sure a TTS engine exists even if the voice session never engaged.
      ensureTts();
      void runCommand(text, { resumeMode: "wake" });
    },
    [
      abortStt,
      clearTimers,
      ensureTts,
      runCommand,
      stopBargeMonitor,
      stopRecognition,
      stopWakeEngine,
    ],
  );

  const getAmplitude = useCallback(() => {
    const s = statusRef.current;
    if (
      s === "active_listening" ||
      s === "follow_up_listening" ||
      s === "listening_wake"
    ) {
      // Real mic loudness, with a faint floor so the viz never flatlines.
      const level = meterRef.current?.inputLevel() ?? 0;
      return Math.max(level, s === "listening_wake" ? 0.04 : 0.08);
    }
    if (s === "speaking") return syntheticEnvelope(0.9);
    if (s === "thinking") return syntheticEnvelope(0.35);
    return 0;
  }, []);

  const toggleBargeIn = useCallback(() => {
    setBargeInEnabled((current) => {
      const next = !current;
      bargeInEnabledRef.current = next;
      // If we're currently speaking and the user just disabled it, kill any
      // active monitor immediately.
      if (!next) {
        stopBargeMonitor();
        bargeOnSpeakingRef.current = null;
      }
      return next;
    });
  }, [stopBargeMonitor]);

  const unlockAudio = useCallback(() => {
    setAudioBlocked(false);
    ttsRef.current?.unlock();
    meterRef.current?.resume();
  }, []);

  // Emergency stop: halt whatever the agent is doing right now (mid-reply or
  // mid computer-use loop) without tearing down the session, then return to
  // passive listening. Driven by the global hotkey (works regardless of which
  // app has focus) and any in-UI stop control.
  const interrupt = useCallback(() => {
    // Stop audio unconditionally — when status is "speaking" the stream is
    // already done and only TTS is draining, so gating on a running command
    // would make Stop a no-op exactly when the user can hear it talking.
    ttsRef.current?.stop();
    stopBargeMonitor();
    bargeOnSpeakingRef.current = null;
    clearToolActivity();
    const running = runningCommandRef.current;
    if (running) {
      // Preserve the partial reply for conversational continuity, and abort so
      // the drain-phase resume guard in runCommand bails instead of re-listening.
      const partial = running.getPartialReply().trim();
      if (partial) messagesRef.current.push({ role: "assistant", content: partial });
      running.abortController.abort();
      runningCommandRef.current = null;
    }
    if (mutedRef.current) setStatus("muted");
    else startModeRef.current?.("wake");
  }, [clearToolActivity, stopBargeMonitor]);

  const stop = useCallback(() => {
    restartGuardRef.current = true;
    clearTimers();
    stopRecognition();
    stopWakeEngine();
    abortStt();
    stopBargeMonitor();
    runningCommandRef.current?.abortController.abort();
    ttsRef.current?.stop();
    meterRef.current?.dispose();
    meterRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    modeRef.current = "off";
    setLoadingModel({ active: false, label: "" });
    clearToolActivity();
    setStatus("idle");
    setLiveCaption("");
    restartGuardRef.current = false;
  }, [abortStt, clearTimers, clearToolActivity, stopBargeMonitor, stopWakeEngine, stopRecognition]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      if (next) {
        // Full standby. Muting must pause *every* input path and abort anything
        // in flight — not just Web Speech. Otherwise a wake engine (vosk is the
        // default), an in-progress STT capture, a pending follow-up timer, or a
        // running command keeps the mic live and actions executing despite the
        // "Muted" UI. We keep the mic stream + meter alive so unmuting is instant.
        restartGuardRef.current = true;
        clearTimers();
        stopRecognition();
        stopWakeEngine();
        abortStt();
        stopBargeMonitor();
        bargeOnSpeakingRef.current = null;
        const running = runningCommandRef.current;
        if (running) {
          // Preserve the partial reply for conversational continuity (as interrupt does).
          const partial = running.getPartialReply().trim();
          if (partial) messagesRef.current.push({ role: "assistant", content: partial });
          running.abortController.abort();
          runningCommandRef.current = null;
        }
        ttsRef.current?.stop();
        clearToolActivity();
        modeRef.current = "off";
        setLiveCaption("");
        restartGuardRef.current = false;
        setStatus("muted");
      } else {
        startMode("wake");
      }
      return next;
    });
  }, [
    abortStt,
    clearTimers,
    clearToolActivity,
    startMode,
    stopBargeMonitor,
    stopRecognition,
    stopWakeEngine,
  ]);

  // Auto-engage on mount. We guard against double-fire from React strict mode
  // and only attempt this once per page lifecycle.
  useEffect(() => {
    if (startedRef.current) return;
    if (needsWebSpeech && !isSpeechRecognitionSupported()) return;
    startedRef.current = true;
    void engage();
  }, [engage, needsWebSpeech]);

  useEffect(() => {
    return () => {
      restartGuardRef.current = true;
      clearTimers();
      stopRecognition();
      stopWakeEngine();
      abortStt();
      stopBargeMonitor();
      runningCommandRef.current?.abortController.abort();
      ttsRef.current?.stop();
      sttEngineRef.current?.engine.dispose();
      sttEngineRef.current = null;
      meterRef.current?.dispose();
      meterRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      toolTimersRef.current.forEach(clearTimeout);
      toolTimersRef.current.clear();
    };
  }, [abortStt, clearTimers, stopBargeMonitor, stopWakeEngine, stopRecognition]);

  // Global hotkey (registered in main) → push to talk, in manual wake mode.
  useEffect(() => {
    const off = window.opendex.onPushToTalk(() => pushToTalk());
    return off;
  }, [pushToTalk]);

  // Global emergency-stop hotkey (⌘/Ctrl+Esc) → abort the current command.
  useEffect(() => {
    const off = window.opendex.onInterrupt(() => interrupt());
    return off;
  }, [interrupt]);

  const canPushToTalk =
    options.wakeMode === "manual" &&
    (status === "listening_wake" || status === "idle");

  return {
    status,
    transcript,
    liveCaption,
    spokenCaption,
    isMuted,
    audioBlocked,
    bargeInEnabled,
    briefingActive,
    loadingModel,
    canPushToTalk,
    pushToTalk,
    submitText,
    interrupt,
    toolActivity,
    getAmplitude,
    unlockAudio,
    stop,
    toggleMute,
    toggleBargeIn,
  };
}
