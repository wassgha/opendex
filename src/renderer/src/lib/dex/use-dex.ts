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
  type SpeechEngine,
  type SpeechEngineKind,
  type SystemVoiceOptions,
} from "./speech-engine";
import { AudioMeter } from "./audio-meter";
import { CloudSttEngine } from "./engines/cloud-stt";
import type { SttEngine, WakeEngine } from "./engines/types";
import type { DexStatus, TranscriptTurn } from "./state";
import type { ChatMessage } from "../../../../main/agent/chat";
import type { SttProvider, WakeMode } from "../../../../main/config/schema";

export interface ModelLoadingState {
  active: boolean;
  label: string;
}

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

const COMMAND_SILENCE_MS = 6000;
const FOLLOW_UP_SILENCE_MS = 10000;
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
  isMuted: boolean;
  audioBlocked: boolean;
  bargeInEnabled: boolean;
  briefingActive: boolean;
  /** Local model download/load progress (Whisper / Vosk). */
  loadingModel: ModelLoadingState;
  /** True when the user can tap/hotkey to talk (manual wake mode, idle). */
  canPushToTalk: boolean;
  pushToTalk: () => void;
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
  const [isMuted, setIsMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [bargeInEnabled, setBargeInEnabled] = useState(false);
  const [briefingActive, setBriefingActive] = useState(false);
  const [loadingModel, setLoadingModel] = useState<ModelLoadingState>({
    active: false,
    label: "",
  });

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
    async (userText: string, opts?: { mode?: "briefing" }) => {
      const isBriefing = opts?.mode === "briefing";
      // The briefing is proactive — we don't show the synthetic prompt as a
      // user turn, but we still record it for conversational continuity.
      if (!isBriefing) appendTurn("user", userText);
      setLiveCaption("");
      setStatus("thinking");
      if (isBriefing) setBriefingActive(true);

      messagesRef.current.push({ role: "user", content: userText });

      const tts = ttsRef.current!;
      const buffer = createSentenceBuffer();
      const abortController = new AbortController();
      let assistantText = "";
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
      try {
        // Stream the reply from the main process over IPC. Each delta feeds the
        // sentence buffer (→ TTS) and the live transcript, exactly as the old
        // HTTP stream did.
        const chatHandle = window.opendex.chat({
          messages: messagesRef.current,
          mode: isBriefing ? "briefing" : undefined,
          onDelta: (value) => {
            if (!value) return;
            assistantText += value;
            updateLastAssistant(assistantText);
            // Refresh the echo-filter word set as new text arrives.
            for (const w of value.toLowerCase().split(/\s+/)) {
              if (w.length > 3) assistantWordsRef.current.add(w);
            }
            for (const chunk of buffer.push(value)) {
              tts.enqueue(chunk);
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
          for (const tail of buffer.flush()) tts.enqueue(tail);
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
      } finally {
        if (runningCommandRef.current?.abortController === abortController) {
          runningCommandRef.current = null;
        }
      }

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

      if (mutedRef.current) {
        setStatus("muted");
      } else {
        startModeRef.current?.("follow_up");
      }
    },
    [
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
      const silenceMs =
        mode === "follow_up" ? FOLLOW_UP_SILENCE_MS : COMMAND_SILENCE_MS;

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
              silenceMs,
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

      const resetSilenceTimer = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(
          () => settle(finalTranscript, true),
          silenceMs,
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
        },
      });
      ttsKindRef.current = ttsEngine;
    }
    return ttsRef.current;
  }, []);

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
    setStatus("idle");
    setLiveCaption("");
    restartGuardRef.current = false;
  }, [abortStt, clearTimers, stopBargeMonitor, stopWakeEngine, stopRecognition]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      if (next) {
        restartGuardRef.current = true;
        stopRecognition();
        stopBargeMonitor();
        ttsRef.current?.stop();
        restartGuardRef.current = false;
        setStatus("muted");
      } else {
        startMode("wake");
      }
      return next;
    });
  }, [startMode, stopBargeMonitor, stopRecognition]);

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
    };
  }, [abortStt, clearTimers, stopBargeMonitor, stopWakeEngine, stopRecognition]);

  // Global hotkey (registered in main) → push to talk, in manual wake mode.
  useEffect(() => {
    const off = window.opendex.onPushToTalk(() => pushToTalk());
    return off;
  }, [pushToTalk]);

  const canPushToTalk =
    options.wakeMode === "manual" &&
    (status === "listening_wake" || status === "idle");

  return {
    status,
    transcript,
    liveCaption,
    isMuted,
    audioBlocked,
    bargeInEnabled,
    briefingActive,
    loadingModel,
    canPushToTalk,
    pushToTalk,
    getAmplitude,
    unlockAudio,
    stop,
    toggleMute,
    toggleBargeIn,
  };
}
