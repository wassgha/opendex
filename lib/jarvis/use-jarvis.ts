"use client";

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
const SILENCE_TIMEOUT_MS = 6000;
const COMMAND_HARD_TIMEOUT_MS = 12000;

type Mode = "off" | "wake" | "command";

interface RunningCommand {
  abortController: AbortController;
}

export interface UseJarvisResult {
  status: JarvisStatus;
  transcript: TranscriptTurn[];
  liveCaption: string;
  engage: () => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
  isMuted: boolean;
}

export function useJarvis(): UseJarvisResult {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [isMuted, setIsMuted] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const modeRef = useRef<Mode>("off");
  const ttsRef = useRef<TtsPlayer | null>(null);
  const messagesRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const runningCommandRef = useRef<RunningCommand | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartGuardRef = useRef(false);
  const mutedRef = useRef(false);

  // Detect unsupported browsers upfront so the UI can render a notice.
  useEffect(() => {
    if (!isSpeechRecognitionSupported()) setStatus("unsupported");
  }, []);

  const appendTurn = useCallback((role: TranscriptTurn["role"], content: string) => {
    const turn: TranscriptTurn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
    };
    setTranscript((prev) => [...prev, turn]);
    return turn.id;
  }, []);

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

  // Forward-declared because runCommand → schedule restart → startMode.
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

  const runCommand = useCallback(
    async (userText: string) => {
      appendTurn("user", userText);
      setLiveCaption("");
      setStatus("thinking");

      messagesRef.current.push({ role: "user", content: userText });

      const tts = ttsRef.current!;
      const buffer = createSentenceBuffer();
      const abortController = new AbortController();
      runningCommandRef.current = { abortController };

      let assistantText = "";

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: messagesRef.current }),
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Chat failed: ${res.status}`);
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        // Transition to speaking as soon as the first audio clip is queued.
        // status stays "thinking" until then.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          assistantText += value;
          updateLastAssistant(assistantText);
          for (const chunk of buffer.push(value)) {
            tts.enqueue(chunk);
          }
        }
        for (const tail of buffer.flush()) tts.enqueue(tail);

        if (assistantText.trim()) {
          messagesRef.current.push({ role: "assistant", content: assistantText.trim() });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error("[jarvis] chat error", err);
        setStatus("error");
        return;
      } finally {
        runningCommandRef.current = null;
      }

      // Wait until TTS queue drains before resuming wake listening.
      const waitForDrain = () =>
        new Promise<void>((resolve) => {
          const check = () => {
            if (!tts.isSpeaking) return resolve();
            setTimeout(check, 120);
          };
          check();
        });
      await waitForDrain();

      if (!mutedRef.current) {
        startModeRef.current?.("wake");
      } else {
        setStatus("muted");
      }
    },
    [appendTurn, updateLastAssistant],
  );

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
          const { finalText, interimText } = joinTranscript(event.results, resultBaseline);
          const combined = `${finalText} ${interimText}`.trim();
          const match = combined.match(WAKE_WORD);
          if (match && match.index !== undefined) {
            const trailing = combined.slice(match.index + match[0].length).trim();
            resultBaseline = event.results.length;
            // Hand off to command mode. If the user already said the rest of the
            // command in the same breath, use it directly; otherwise listen.
            if (trailing.length >= 3) {
              stopRecognition();
              void runCommand(trailing);
            } else {
              startModeRef.current?.("command");
            }
          }
        };
        rec.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setStatus("error");
            return;
          }
          // 'no-speech', 'aborted', etc. → restart loop handles it
        };
        rec.onend = () => {
          if (modeRef.current === "wake" && !restartGuardRef.current && !mutedRef.current) {
            try {
              rec.start();
            } catch {
              setTimeout(() => {
                if (modeRef.current === "wake" && !mutedRef.current) {
                  startModeRef.current?.("wake");
                }
              }, 250);
            }
          }
        };
        try {
          rec.start();
        } catch (err) {
          console.error("[jarvis] failed to start wake recognition", err);
        }
        return;
      }

      // mode === "command"
      setStatus("active_listening");
      setLiveCaption("");
      let finalTranscript = "";
      let resolved = false;
      const settle = (text: string) => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        stopRecognition();
        const cleaned = text.trim();
        if (cleaned.length === 0) {
          // nothing heard — return to wake mode
          startModeRef.current?.("wake");
        } else {
          void runCommand(cleaned);
        }
      };

      // hard cap so we never get stuck listening
      hardTimerRef.current = setTimeout(() => settle(finalTranscript), COMMAND_HARD_TIMEOUT_MS);

      const resetSilenceTimer = () => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => settle(finalTranscript), SILENCE_TIMEOUT_MS);
      };
      resetSilenceTimer();

      rec.onresult = (event) => {
        const { finalText, interimText } = joinTranscript(event.results);
        finalTranscript = finalText;
        setLiveCaption(interimText || finalText);
        resetSilenceTimer();
      };
      rec.onspeechend = () => {
        // Brief delay so trailing final result has a chance to arrive.
        setTimeout(() => settle(finalTranscript), 600);
      };
      rec.onend = () => {
        if (!resolved) settle(finalTranscript);
      };
      rec.onerror = (event) => {
        if (event.error === "no-speech") {
          settle(finalTranscript);
          return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
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

  // Lazy-init the TTS player on first engage so we don't construct audio
  // contexts during SSR or before any user gesture.
  const ensureTts = useCallback(() => {
    if (!ttsRef.current) {
      ttsRef.current = new TtsPlayer((speaking) => {
        if (speaking) setStatus("speaking");
      });
    }
    return ttsRef.current;
  }, []);

  const engage = useCallback(async () => {
    if (!isSpeechRecognitionSupported()) {
      setStatus("unsupported");
      return;
    }
    try {
      // Explicit getUserMedia gate so denial is detected up front and audio
      // permissions are warm before SpeechRecognition needs them.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.error("[jarvis] mic permission denied", err);
      setStatus("error");
      return;
    }
    ensureTts();
    mutedRef.current = false;
    setIsMuted(false);
    startMode("wake");
  }, [ensureTts, startMode]);

  const stop = useCallback(() => {
    restartGuardRef.current = true;
    clearTimers();
    stopRecognition();
    runningCommandRef.current?.abortController.abort();
    ttsRef.current?.stop();
    modeRef.current = "off";
    setStatus("idle");
    setLiveCaption("");
    restartGuardRef.current = false;
  }, [clearTimers, stopRecognition]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      if (next) {
        restartGuardRef.current = true;
        stopRecognition();
        restartGuardRef.current = false;
        setStatus("muted");
      } else {
        startMode("wake");
      }
      return next;
    });
  }, [startMode, stopRecognition]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      restartGuardRef.current = true;
      clearTimers();
      stopRecognition();
      runningCommandRef.current?.abortController.abort();
      ttsRef.current?.stop();
    };
  }, [clearTimers, stopRecognition]);

  return {
    status,
    transcript,
    liveCaption,
    engage,
    stop,
    toggleMute,
    isMuted,
  };
}
