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
import { RealtimeVoiceSession } from "./realtime/realtime-session";
import type { SttEngine, WakeEngine } from "./engines/types";
import type { DexStatus, TranscriptTurn } from "./state";
import { formatToolCall } from "../format-tool-call";
import type { ToolInvocation } from "@skills/tool-view";
import {
  RUN_TASK_TOOL,
  type ToolCallEvent,
  type ToolResultEvent,
} from "../../../../main/ipc/channels";
import type { ChatMessage } from "../../../../main/agent/chat";
import type { SttProvider, VoiceMode, WakeMode } from "../../../../main/config/schema";

export interface ModelLoadingState {
  active: boolean;
  label: string;
}

export interface ToolActivity {
  id: string;
  icon: string;
  label: string;
}

// Re-exported so themes/components can keep importing the tool-invocation shape
// from the voice hook; the canonical definition lives with the skills module.
export type { ToolInvocation };

/** A tool result is an error if it carries a top-level string `error` field
 *  (the shape our skills return on failure). */
function isErrorResult(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    typeof (output as { error?: unknown }).error === "string"
  );
}

// How long a tool-activity banner lingers before fading out.
const TOOL_ACTIVITY_TTL_MS = 4000;


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
// Barge-in (interrupting the assistant while it speaks) is wake-word triggered:
// the same offline keyword spotter used for wake runs during playback. Because
// it only fires on the wake word — not arbitrary speech — it can't echo-loop on
// the assistant's own audio, so it's always on (no AEC gymnastics needed). Brief
// cooldown so the tail of the previous turn can't immediately re-trigger it.
const BARGE_COOLDOWN_MS = 600;
// While a delegated run_task runs in realtime mode, ask the realtime voice for
// a spoken progress update at most this often (and only between its sentences).
// Deliberately sparse — every request WILL make the model say something, and a
// stream of "still working on it" is worse than quiet work under the overlay's
// visual activity banners.
const REALTIME_NARRATION_MIN_MS = 25000;

type Mode = "off" | "wake" | "command" | "follow_up";

interface RunningCommand {
  abortController: AbortController;
  getPartialReply: () => string;
}

export interface UseDexOptions {
  /** pipeline = wake→STT→LLM→TTS · realtime = one speech-to-speech session
   *  (the wake word still gates when a session connects). */
  voiceMode: VoiceMode;
  /** Realtime: seconds of all-quiet before the session hangs up back to wake. */
  realtimeIdleDisconnectSec: number;
  /** Wake word that triggers active listening (Web Speech wake mode). */
  wakeWord: string;
  /** How active listening is triggered. */
  wakeMode: WakeMode;
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
  /** Whether to surface tool-call action hints (drives the overlay HUD). */
  showToolActivity?: boolean;
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
  /** Dismiss the current turn and start a fresh conversation (clears transcript,
   *  history, and result cards; stays listening). */
  newConversation: () => void;
  /** Recent tool calls the agent made (transient; for the activity banners). */
  toolActivity: ToolActivity[];
  /** Tool calls + results for the current session (persistent; for result cards). */
  toolInvocations: ToolInvocation[];
  /** Current voice loudness, 0..1 — real mic level while listening, a synthetic
   *  envelope while speaking/thinking. Sampled by the visualization via rAF. */
  getAmplitude: () => number;
  unlockAudio: () => void;
  stop: () => void;
  toggleMute: () => void;
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
  const [briefingActive, setBriefingActive] = useState(false);
  const [loadingModel, setLoadingModel] = useState<ModelLoadingState>({
    active: false,
    label: "",
  });
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const toolTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Persistent call+result records for result-card rendering (no TTL).
  const [toolInvocations, setToolInvocations] = useState<ToolInvocation[]>([]);

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

  // Record a tool call as a running invocation (replacing any prior record with
  // the same id, e.g. on a retried step).
  const recordToolCall = useCallback((call: ToolCallEvent) => {
    setToolInvocations((prev) => [
      ...prev.filter((t) => t.id !== call.toolCallId),
      {
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
        result: null,
        status: "running",
      },
    ]);
  }, []);

  // Fill in a running invocation's result when the tool returns.
  const recordToolResult = useCallback((result: ToolResultEvent) => {
    setToolInvocations((prev) =>
      prev.map((t) =>
        t.id === result.toolCallId
          ? {
              ...t,
              result: result.output,
              status: isErrorResult(result.output) ? "error" : "done",
            }
          : t,
      ),
    );
  }, []);

  const clearToolActivity = useCallback(() => {
    toolTimersRef.current.forEach(clearTimeout);
    toolTimersRef.current.clear();
    setToolActivity([]);
    setToolInvocations([]);
  }, []);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Wake-word barge monitor (runs during speaking). A small disposable handle,
  // since the underlying engine may attach asynchronously (Vosk WASM import).
  const bargeRef = useRef<{ dispose: () => void } | null>(null);
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
  // filter for the follow-up listening window.
  const assistantWordsRef = useRef<Set<string>>(new Set());

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
    const monitor = bargeRef.current;
    bargeRef.current = null;
    monitor?.dispose();
  }, []);

  // Listen for the wake word *while the assistant is speaking* so the user can
  // cut in by name. Uses the configured wake engine (Vosk offline by default);
  // on a hit it fires `onBarge` exactly once. Manual mode has no voice wake, so
  // it relies on the Stop control / hotkey instead.
  const startBargeMonitor = useCallback(
    (onBarge: () => void) => {
      stopBargeMonitor();
      const startedAt = Date.now();
      let fired = false;

      // A handle so teardown disposes whichever engine ends up attached (the
      // Vosk import resolves async). `dispose` is idempotent.
      const handle: { engine: { dispose: () => void } | null; dispose: () => void } = {
        engine: null,
        dispose() {
          this.engine?.dispose();
          this.engine = null;
        },
      };
      bargeRef.current = handle;

      const trigger = () => {
        if (fired || mutedRef.current) return;
        if (Date.now() - startedAt < BARGE_COOLDOWN_MS) return;
        fired = true;
        stopBargeMonitor();
        onBarge();
      };

      const opts = optionsRef.current;
      if (opts.wakeMode === "vosk") {
        void (async () => {
          const { VoskWakeEngine } = await import("./engines/vosk-wake");
          // Speaking may have ended (and this monitor been torn down) while the
          // WASM loaded — bail if a newer monitor/teardown superseded us.
          if (bargeRef.current !== handle) return;
          const engine = new VoskWakeEngine(opts.wakeWord, undefined, () => {}, () => {});
          handle.engine = engine;
          await engine.start(trigger);
        })();
      } else if (opts.wakeMode === "webspeech") {
        const rec = createRecognition({
          continuous: true,
          interimResults: true,
          lang: "en-US",
        });
        if (rec) {
          handle.engine = {
            dispose: () => {
              try {
                rec.abort();
              } catch {
                /* already stopped */
              }
            },
          };
          rec.onresult = (event) => {
            const { finalText, interimText } = joinTranscript(event.results);
            const heard = `${finalText} ${interimText}`.trim();
            if (buildWakeRegex(opts.wakeWord).test(heard)) trigger();
          };
          rec.onend = () => {
            if (bargeRef.current === handle && !fired) {
              try {
                rec.start();
              } catch {
                /* speaking will tear this down soon */
              }
            }
          };
          try {
            rec.start();
          } catch {
            /* noop */
          }
        }
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
      runningCommandRef.current = {
        abortController,
        getPartialReply: () => assistantText,
      };

      // Reset the assistant-word filter for the new reply.
      assistantWordsRef.current = new Set();
      // Fresh result cards per turn (so a prior turn's weather/clock card doesn't
      // linger next to an unrelated reply).
      setToolInvocations([]);

      // Wake-word barge-in: when the user says the wake word mid-reply, stop the
      // assistant, keep the partial reply for context, and drop straight into
      // active listening for their new command. Armed once here; the monitor
      // actually starts when TTS transitions to "speaking" (bargeOnSpeakingRef).
      const handleBarge = () => {
        const partial = assistantText.trim();
        if (partial) {
          messagesRef.current.push({ role: "assistant", content: partial });
        }
        tts.stop();
        abortController.abort();
        runningCommandRef.current = null;
        stopBargeMonitor();
        // Listen for the follow-up command they're about to speak.
        startModeRef.current?.("command");
      };

      bargeOnSpeakingRef.current = () => startBargeMonitor(handleBarge);

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
            recordToolCall(call);
          },
          onToolResult: recordToolResult,
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
            for (const chunk of buffer.push(value)) speak(chunk);
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
          // Flush any trailing partial sentence to TTS.
          for (const tail of buffer.flush()) speak(tail);
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
      recordToolCall,
      recordToolResult,
      appendTurn,
      startBargeMonitor,
      stopBargeMonitor,
      updateLastAssistant,
    ],
  );

  // Hook between TtsPlayer's "speaking" transition and the barge monitor start.
  const bargeOnSpeakingRef = useRef<(() => void) | null>(null);

  // ---- Realtime voice mode ----
  // One speech-to-speech session replaces the STT→chat→TTS pipeline. The wake
  // word still gates when it connects; server VAD handles turns + barge-in
  // (the wake-word barge monitor is never armed — runCommand isn't used).
  const realtimeSessionRef = useRef<RealtimeVoiceSession | null>(null);
  // In-flight run_task delegation (a pipeline chat driven on the session's behalf).
  const realtimeTaskRef = useRef<{ cancel: () => void } | null>(null);
  // Options carried into the next realtime conversation (set by the wake paths,
  // consumed by startMode's realtime branch — so all entry points still funnel
  // through startMode's teardown).
  const realtimePendingRef = useRef<{ briefing?: boolean; initialText?: string } | null>(null);
  const realtimeTurnTextRef = useRef("");
  const realtimeHadTurnRef = useRef(false);
  // Monotonic token guarding the (multi-await) session connect flow. Every
  // teardown and every newer connect bumps it; an in-flight connect re-checks
  // it after each await and abandons — ending its half-started session — when
  // superseded. Without this, two overlapping connects both pass the
  // "no session yet" check and the loser leaks as a second live voice.
  const realtimeGenRef = useRef(0);

  const closeRealtime = useCallback(() => {
    realtimeGenRef.current += 1;
    realtimeTaskRef.current?.cancel();
    realtimeTaskRef.current = null;
    realtimeSessionRef.current?.close();
    realtimeSessionRef.current = null;
  }, []);

  // Drive a delegated run_task: the realtime model handed us a task, we run it
  // through the EXISTING pipeline chat path (configured LLM, full toolset incl.
  // computer-use, permission gate, activity banners), feed progress notes back
  // into the session so the realtime voice can narrate, and answer the tool
  // call with the agent's final report.
  const runDelegatedTask = useCallback(
    (session: RealtimeVoiceSession, toolCallId: string, task: string) => {
      realtimeTaskRef.current?.cancel();
      setStatus("thinking");
      const buffer = createSentenceBuffer();
      let finalText = "";
      // Start the throttle "full": the model already acknowledged out loud when
      // it called run_task, so the first spoken update comes only after real
      // progress has accumulated. Actions/sentences are still injected silently
      // — the model reads them all next time it's asked to speak.
      let lastNarration = Date.now();
      // Ask the voice for a brief spoken update — sparsely, and never over its
      // own speech.
      const narrate = () => {
        const now = Date.now();
        if (now - lastNarration < REALTIME_NARRATION_MIN_MS) return;
        if (session.isSpeaking) return;
        lastNarration = now;
        session.requestResponse();
      };
      const handle = window.opendex.chat({
        messages: [{ role: "user", content: task }],
        onToolCall: (call) => {
          // The sub-agent's own actions surface as activity banners (overlay)
          // and as silent context notes; only progress *sentences* may trigger
          // a spoken update — per-click narration was a bombardment.
          addToolActivity(call);
          session.injectContext(`[task action] ${formatToolCall(call).label}`);
        },
        onDelta: (value) => {
          finalText += value;
          for (const sentence of buffer.push(value)) {
            session.injectContext(`[task progress] ${sentence}`);
            narrate();
          }
        },
      });
      const cancel = () => handle.cancel();
      realtimeTaskRef.current = { cancel };
      const settle = (output: unknown) => {
        if (realtimeTaskRef.current?.cancel === cancel) realtimeTaskRef.current = null;
        recordToolResult({ toolCallId, toolName: RUN_TASK_TOOL, output });
        // Only answer if the session that asked is still the live one.
        if (realtimeSessionRef.current === session) {
          session.sendToolResult(toolCallId, RUN_TASK_TOOL, output);
        }
      };
      handle.done
        .then(() =>
          settle({ result: finalText.trim() || "The task finished with no report." }),
        )
        .catch((err) =>
          settle({ error: err instanceof Error ? err.message : String(err) }),
        );
    },
    [addToolActivity, recordToolResult],
  );

  // Open a realtime session and wire it into the same state surface the
  // pipeline uses (statuses, transcript, captions, tool records) — so themes,
  // the overlay, and the notch work unchanged.
  const startRealtimeConversation = useCallback(
    async (convOpts?: { briefing?: boolean; initialText?: string }) => {
      if (mutedRef.current) return;
      // Already connected (typed input mid-conversation): just send the text.
      const existing = realtimeSessionRef.current;
      if (existing) {
        if (convOpts?.initialText) {
          existing.cancelResponse();
          appendTurn("user", convOpts.initialText);
          messagesRef.current.push({ role: "user", content: convOpts.initialText });
          setStatus("thinking");
          existing.sendUserText(convOpts.initialText);
        }
        return;
      }

      vlog("realtime:connect:start", { briefing: Boolean(convOpts?.briefing) });
      // Claim the connect slot: any older in-flight connect is now stale and
      // will abandon at its next checkpoint.
      const gen = ++realtimeGenRef.current;
      setStatus("thinking");
      setLiveCaption("");
      spokenFreshRef.current = true;
      if (convOpts?.briefing) setBriefingActive(true);

      let start: Awaited<ReturnType<typeof window.opendex.realtimeStart>>;
      try {
        start = await window.opendex.realtimeStart({
          briefing: Boolean(convOpts?.briefing),
        });
      } catch (err) {
        if (realtimeGenRef.current !== gen) return; // superseded — not ours to handle
        // Unset key / failed connect — surface the user-facing reason in the
        // transcript (there is no TTS engine to speak it in this mode).
        const message = err instanceof Error ? err.message : String(err);
        console.error("[opendex] realtime start failed", err);
        updateLastAssistant(message);
        setBriefingActive(false);
        startModeRef.current?.("wake");
        return;
      }
      // Superseded / muted / torn down while connecting — end the fresh
      // session in main (it's fully registered once realtimeStart resolves).
      if (
        realtimeGenRef.current !== gen ||
        mutedRef.current ||
        modeRef.current !== "command"
      ) {
        window.opendex.realtimeEnd(start.sessionId);
        return;
      }

      realtimeTurnTextRef.current = "";
      realtimeHadTurnRef.current = false;
      const isBriefing = Boolean(convOpts?.briefing);

      const session = new RealtimeVoiceSession({
        micStream: micStreamRef.current!,
        idleDisconnectSec: optionsRef.current.realtimeIdleDisconnectSec,
        callbacks: {
          onUserSpeechStart: () => {
            if (realtimeSessionRef.current !== session) return;
            setStatus("active_listening");
            setLiveCaption("");
          },
          onUserTranscript: (text) => {
            if (realtimeSessionRef.current !== session) return;
            appendTurn("user", text);
            messagesRef.current.push({ role: "user", content: text });
          },
          onAssistantDelta: (text) => {
            if (realtimeSessionRef.current !== session) return;
            realtimeTurnTextRef.current += text;
            // The realtime transcript tracks the audio, so it doubles as the
            // speech-synced caption.
            updateLastAssistant(realtimeTurnTextRef.current);
            setSpokenCaption(realtimeTurnTextRef.current);
          },
          onTurnDone: () => {
            if (realtimeSessionRef.current !== session) return;
            const turn = realtimeTurnTextRef.current.trim();
            if (turn) messagesRef.current.push({ role: "assistant", content: turn });
            realtimeTurnTextRef.current = "";
            realtimeHadTurnRef.current = true;
            if (isBriefing) setBriefingActive(false);
          },
          onSpeakingChange: (speaking) => {
            if (realtimeSessionRef.current !== session) return;
            if (speaking) setStatus("speaking");
            else if (realtimeTaskRef.current) setStatus("thinking");
            else {
              setStatus(
                realtimeHadTurnRef.current
                  ? "follow_up_listening"
                  : "active_listening",
              );
            }
          },
          onToolCall: (call) => {
            if (realtimeSessionRef.current !== session) return;
            // No banner for run_task — its input is the full task prompt
            // (way too long for a hint), and the delegated sub-agent's own
            // actions stream their own banners the moment it starts working.
            if (call.toolName !== RUN_TASK_TOOL) addToolActivity(call);
            recordToolCall(call);
            setStatus("thinking");
          },
          onToolResult: (result) => {
            if (realtimeSessionRef.current !== session) return;
            recordToolResult(result);
          },
          onRunTask: (toolCallId, task) => {
            if (realtimeSessionRef.current !== session) return;
            runDelegatedTask(session, toolCallId, task);
          },
          onDisconnect: (reason) => {
            if (realtimeSessionRef.current !== session) return;
            vlog("realtime:disconnect", { reason });
            realtimeSessionRef.current = null;
            realtimeTaskRef.current?.cancel();
            realtimeTaskRef.current = null;
            setBriefingActive(false);
            if (mutedRef.current) setStatus("muted");
            else startModeRef.current?.("wake");
          },
          onAudioBlocked: () => setAudioBlocked(true),
        },
      });
      realtimeSessionRef.current = session;

      try {
        await session.connect(start);
      } catch (err) {
        console.error("[opendex] realtime audio setup failed", err);
        if (realtimeSessionRef.current === session) realtimeSessionRef.current = null;
        session.close();
        if (realtimeGenRef.current === gen) startModeRef.current?.("wake");
        return;
      }
      // Superseded while the audio path was built (a teardown or a newer
      // conversation claimed the slot) — close this session and step aside.
      if (realtimeGenRef.current !== gen) {
        if (realtimeSessionRef.current === session) realtimeSessionRef.current = null;
        session.close();
        return;
      }
      vlog("realtime:connect:open");

      // No session resume across reconnects — seed the fresh session with the
      // recent conversation so "what did I just ask you?" keeps working.
      const history = messagesRef.current
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .slice(-10);
      if (history.length > 0) {
        session.injectContext(
          `[earlier conversation]\n${history
            .map((m) => `${m.role}: ${m.content as string}`)
            .join("\n")}`,
        );
      }

      if (isBriefing && start.greetingPrompt) {
        session.sendUserText(start.greetingPrompt);
      } else if (convOpts?.initialText) {
        appendTurn("user", convOpts.initialText);
        messagesRef.current.push({ role: "user", content: convOpts.initialText });
        session.sendUserText(convOpts.initialText);
      } else {
        setStatus("active_listening");
      }
    },
    [
      addToolActivity,
      appendTurn,
      recordToolCall,
      recordToolResult,
      runDelegatedTask,
      updateLastAssistant,
    ],
  );

  const startMode = useCallback(
    (mode: Mode) => {
      stopRecognition();
      stopWakeEngine();
      abortStt();
      clearTimers();
      // Tear down the wake-word barge monitor too — any transition out of the
      // speaking phase should release its mic (no-op if not running).
      stopBargeMonitor();
      // Returning to passive wake (or off) ends any realtime session — it
      // reconnects on the next wake. No-op in pipeline mode / when closed.
      if (mode === "wake" || mode === "off") closeRealtime();

      // Hard standby guard. A wake event that fired just before mute (vosk match,
      // a queued Web Speech onresult) runs its callback *after* mute tore
      // everything down and re-enters startMode. While
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
        // for a command. In realtime mode "listen for a command" means
        // "connect a session" — the pending options ride realtimePendingRef
        // through startMode("command") so its teardown still runs.
        const onWake = () => {
          // A wake detection queued just before mute can fire after the engine
          // was torn down. Ignore it so voice never re-engages while on standby.
          if (mutedRef.current) return;
          const briefing = !hasBriefedRef.current && opts.greetingEnabled;
          if (optionsRef.current.voiceMode === "realtime") {
            if (briefing) hasBriefedRef.current = true;
            realtimePendingRef.current = { briefing };
            startModeRef.current?.("command");
            return;
          }
          if (briefing) {
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
            if (optionsRef.current.voiceMode === "realtime") {
              realtimePendingRef.current = { briefing: true };
              startModeRef.current?.("command");
            } else {
              void runCommand("Give me my briefing.", { mode: "briefing" });
            }
          }
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
            const briefing =
              !hasBriefedRef.current && optionsRef.current.greetingEnabled;
            if (optionsRef.current.voiceMode === "realtime") {
              if (briefing) hasBriefedRef.current = true;
              // Words spoken after the wake word become the opening message.
              realtimePendingRef.current = {
                briefing,
                initialText: trailing.length >= 3 ? trailing : undefined,
              };
              startModeRef.current?.("command");
              return;
            }
            // The first time the operator wakes the assistant, deliver the
            // proactive greeting (if enabled) instead of listening for a command.
            if (briefing) {
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
      // Realtime mode: "capturing a command" means an open speech-to-speech
      // session — connect it (statuses are driven by its callbacks) instead of
      // running an STT capture.
      if (opts.voiceMode === "realtime") {
        const pending = realtimePendingRef.current;
        realtimePendingRef.current = null;
        void startRealtimeConversation(pending ?? {});
        return;
      }
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
          // Nothing heard — both command and follow-up roll back to passive wake.
          startModeRef.current?.("wake");
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
    [
      abortStt,
      clearTimers,
      closeRealtime,
      ensureSttEngine,
      runCommand,
      startRealtimeConversation,
      stopBargeMonitor,
      stopWakeEngine,
      stopRecognition,
    ],
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

  // Wake: Vosk captures its keyword at construction. If we're sitting in passive
  // wake, restart so the new wake engine takes over. Don't interrupt an in-flight
  // command or reply.
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
  }, [options.wakeMode, options.wakeWord]);

  // Voice mode (pipeline ↔ realtime) switched live in Settings: end any open
  // realtime session and re-arm passive wake so the next wake uses the new path.
  useEffect(() => {
    if (!startedRef.current) return;
    closeRealtime();
    if (!mutedRef.current) startModeRef.current?.("wake");
  }, [options.voiceMode, closeRealtime]);

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

      // Realtime mode: send into the open session (interrupting its reply,
      // like a barge), or connect one with the text as the opening message.
      if (optionsRef.current.voiceMode === "realtime") {
        if (realtimeSessionRef.current) {
          void startRealtimeConversation({ initialText: text });
        } else {
          realtimePendingRef.current = { initialText: text };
          startModeRef.current?.("command");
        }
        return;
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
      startRealtimeConversation,
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
    if (s === "speaking") {
      // Realtime playback is metered for real (the model's actual voice);
      // pipeline TTS keeps the synthetic envelope.
      const realtime = realtimeSessionRef.current;
      if (realtime) return Math.max(realtime.outputLevel(), 0.08);
      return syntheticEnvelope(0.9);
    }
    if (s === "thinking") return syntheticEnvelope(0.35);
    return 0;
  }, []);

  const unlockAudio = useCallback(() => {
    setAudioBlocked(false);
    ttsRef.current?.unlock();
    realtimeSessionRef.current?.unlock();
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
    // Realtime: kill the session (and any delegated task) outright; the wake
    // word reconnects. startMode("wake") below is what re-arms listening.
    closeRealtime();
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
  }, [clearToolActivity, closeRealtime, stopBargeMonitor]);

  // Start a fresh conversation: abort anything in flight, wipe the transcript +
  // model history + result cards + captions, and return to passive listening
  // (without tearing down the mic/engines). This is how the user dismisses the
  // current turn — e.g. clearing a lingering result card once they've read it.
  const newConversation = useCallback(() => {
    ttsRef.current?.stop();
    closeRealtime();
    stopBargeMonitor();
    bargeOnSpeakingRef.current = null;
    runningCommandRef.current?.abortController.abort();
    runningCommandRef.current = null;
    messagesRef.current = [];
    setTranscript([]);
    setLiveCaption("");
    setSpokenCaption("");
    spokenFreshRef.current = true;
    clearToolActivity(); // clears the activity banners + the result cards
    if (mutedRef.current) setStatus("muted");
    else startModeRef.current?.("wake");
  }, [clearToolActivity, closeRealtime, stopBargeMonitor]);

  const stop = useCallback(() => {
    restartGuardRef.current = true;
    clearTimers();
    stopRecognition();
    stopWakeEngine();
    abortStt();
    stopBargeMonitor();
    closeRealtime();
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
  }, [abortStt, clearTimers, clearToolActivity, closeRealtime, stopBargeMonitor, stopWakeEngine, stopRecognition]);

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
        closeRealtime();
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
    closeRealtime,
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
      closeRealtime();
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
  }, [abortStt, clearTimers, closeRealtime, stopBargeMonitor, stopWakeEngine, stopRecognition]);

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

  // Publish a snapshot of the live session to main, which re-broadcasts it to
  // the overlay HUD / notch surfaces (the only place this state lives, since the
  // voice loop runs solely in this window). Cheap; fires only on real changes.
  const showToolActivity = options.showToolActivity ?? true;
  useEffect(() => {
    // The current turn's streamed reply — only when the *last* turn is the
    // assistant's. While a new turn is starting (the user turn was just appended
    // but no reply has streamed yet), this is "" so view surfaces don't show the
    // previous turn's stale answer during the thinking gap.
    const lastTurn = transcript[transcript.length - 1];
    const reply = lastTurn?.role === "assistant" ? lastTurn.content : "";
    window.opendex.publishSessionState({
      status,
      muted: isMuted,
      // Respect the user's "show tool activity" toggle: when off, the overlay
      // still shows status/Stop but no per-action hints.
      activity: showToolActivity
        ? toolActivity.map((t) => ({ id: t.id, icon: t.icon, label: t.label }))
        : [],
      // Result cards are content (not action-hint noise), so they're relayed
      // regardless of the showToolActivity toggle.
      toolInvocations,
      liveCaption,
      spokenCaption,
      reply,
    });
  }, [
    status,
    isMuted,
    toolActivity,
    toolInvocations,
    liveCaption,
    spokenCaption,
    transcript,
    showToolActivity,
  ]);

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
    toolInvocations,
    newConversation,
  };
}
