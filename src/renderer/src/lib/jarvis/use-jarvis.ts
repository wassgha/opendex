import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRecognition,
  isSpeechRecognitionSupported,
  joinTranscript,
  type SpeechRecognitionInstance,
} from "./speech-recognition";
import { createSentenceBuffer } from "./sentence-buffer";
import { TtsPlayer } from "./tts-player";
import type { JarvisStatus, TranscriptTurn } from "./state";

const WAKE_WORD = /\bjarvis\b/i;
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
// Barge-in (interrupting Jarvis while he speaks) is opt-in. Without proper
// hardware AEC, listening while audio plays produces echo-induced loops.
const BARGE_COOLDOWN_MS = 1200;
const BARGE_MIN_CHARS = 16;
const BARGE_NEW_WORD_RATIO = 0.8;

type Mode = "off" | "wake" | "command" | "follow_up";

interface RunningCommand {
  abortController: AbortController;
  getPartialReply: () => string;
}

export interface UseJarvisResult {
  status: JarvisStatus;
  transcript: TranscriptTurn[];
  liveCaption: string;
  isMuted: boolean;
  audioBlocked: boolean;
  bargeInEnabled: boolean;
  briefingActive: boolean;
  unlockAudio: () => void;
  stop: () => void;
  toggleMute: () => void;
  toggleBargeIn: () => void;
}

export function useJarvis(): UseJarvisResult {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [bargeInEnabled, setBargeInEnabled] = useState(false);
  const [briefingActive, setBriefingActive] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const bargeRef = useRef<SpeechRecognitionInstance | null>(null);
  const modeRef = useRef<Mode>("off");
  const ttsRef = useRef<TtsPlayer | null>(null);
  const messagesRef = useRef<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
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

  useEffect(() => {
    if (!isSpeechRecognitionSupported()) setStatus("unsupported");
  }, []);

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
        // Jarvis's own recent reply.
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
        console.error("[jarvis] failed to start barge monitor", err);
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
      // Without proper hardware AEC, listening while Jarvis speaks produces
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

        await chatHandle.done;

        if (abortController.signal.aborted) {
          // Cancelled by barge-in or stop — skip the drain/follow-up transition.
          bargedIn = true;
        } else {
          for (const tail of buffer.flush()) tts.enqueue(tail);
          if (assistantText.trim()) {
            messagesRef.current.push({
              role: "assistant",
              content: assistantText.trim(),
            });
          }
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
      // mic doesn't pick up the tail of Jarvis's own voice.
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
      clearTimers();
      modeRef.current = mode;

      if (mode === "off") {
        setStatus(mutedRef.current ? "muted" : "idle");
        return;
      }

      const rec = createRecognition({
        continuous: mode === "wake",
        interimResults: true,
        lang: "en-US",
      });
      if (!rec) {
        setStatus("unsupported");
        return;
      }
      recognitionRef.current = rec;

      if (mode === "wake") {
        setStatus("listening_wake");
        setLiveCaption("");
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
          const match = combined.match(WAKE_WORD);
          if (match && match.index !== undefined) {
            const trailing = combined.slice(match.index + match[0].length).trim();
            resultBaseline = event.results.length;
            // The very first time the operator wakes Jarvis, deliver the
            // proactive morning briefing instead of listening for a command.
            if (!hasBriefedRef.current) {
              hasBriefedRef.current = true;
              stopRecognition();
              void runCommand("Give me my morning briefing on how CoreViz is doing.", {
                mode: "briefing",
              });
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
          console.error("[jarvis] failed to start wake recognition", err);
        }
        return;
      }

      // mode === "command" | "follow_up"
      setStatus(mode === "follow_up" ? "follow_up_listening" : "active_listening");
      setLiveCaption("");
      const silenceMs =
        mode === "follow_up" ? FOLLOW_UP_SILENCE_MS : COMMAND_SILENCE_MS;
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
        // transcripts that look like the tail of Jarvis's reply leaking through
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
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          setStatus("error");
          resolved = true;
          return;
        }
      };

      try {
        rec.start();
      } catch (err) {
        console.error("[jarvis] failed to start command recognition", err);
      }
    },
    [clearTimers, runCommand, stopRecognition],
  );

  startModeRef.current = startMode;

  const ensureTts = useCallback(() => {
    if (!ttsRef.current) {
      ttsRef.current = new TtsPlayer({
        onStateChange: (speaking) => {
          if (speaking) {
            setStatus("speaking");
            bargeOnSpeakingRef.current?.();
          }
          // Note: the "speaking=false" transition is handled in runCommand's
          // waitForDrain, which is responsible for the next status.
        },
        onAudioBlocked: () => setAudioBlocked(true),
      });
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
        console.error("[jarvis] mic permission denied", err);
        setStatus("error");
        return;
      }
    }
    ensureTts();
    mutedRef.current = false;
    setIsMuted(false);
    startMode("wake");
  }, [ensureTts, startMode]);

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
  }, []);

  const stop = useCallback(() => {
    restartGuardRef.current = true;
    clearTimers();
    stopRecognition();
    stopBargeMonitor();
    runningCommandRef.current?.abortController.abort();
    ttsRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    modeRef.current = "off";
    setStatus("idle");
    setLiveCaption("");
    restartGuardRef.current = false;
  }, [clearTimers, stopBargeMonitor, stopRecognition]);

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
    if (!isSpeechRecognitionSupported()) return;
    startedRef.current = true;
    void engage();
  }, [engage]);

  useEffect(() => {
    return () => {
      restartGuardRef.current = true;
      clearTimers();
      stopRecognition();
      stopBargeMonitor();
      runningCommandRef.current?.abortController.abort();
      ttsRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    };
  }, [clearTimers, stopBargeMonitor, stopRecognition]);

  return {
    status,
    transcript,
    liveCaption,
    isMuted,
    audioBlocked,
    bargeInEnabled,
    briefingActive,
    unlockAudio,
    stop,
    toggleMute,
    toggleBargeIn,
  };
}
