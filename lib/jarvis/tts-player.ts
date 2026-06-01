"use client";

// FIFO TTS playback queue. Each enqueued sentence is fetched from /api/tts in
// parallel, then audio elements are played strictly in order so the speech is
// gapless even if later requests resolve before earlier ones.
//
// If the browser blocks playback (autoplay policy — no user gesture yet), the
// player parks the queue and notifies the orchestrator via `onAudioBlocked`.
// Calling `unlock()` after a user gesture resumes the queue.

interface QueuedClip {
  text: string;
  blobPromise: Promise<Blob>;
}

export interface TtsPlayerCallbacks {
  onStateChange: (speaking: boolean) => void;
  onAudioBlocked: () => void;
}

export class TtsPlayer {
  private queue: QueuedClip[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private audioBlocked = false;
  private unlockResolver: (() => void) | null = null;

  constructor(private readonly cb: TtsPlayerCallbacks) {}

  enqueue(text: string) {
    if (!text.trim()) return;
    if (!this.abortController) this.abortController = new AbortController();
    const blobPromise = fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: this.abortController.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`TTS failed: ${msg}`);
      }
      return res.blob();
    });
    this.queue.push({ text, blobPromise });
    void this.pump();
  }

  private async pump() {
    if (this.playing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    this.cb.onStateChange(true);
    try {
      const blob = await next.blobPromise;
      await this.playBlob(blob);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[jarvis tts] playback error", err);
      }
    } finally {
      this.playing = false;
      if (this.queue.length > 0) {
        void this.pump();
      } else {
        this.cb.onStateChange(false);
      }
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tryPlay = async () => {
        if (this.audioBlocked) await this.waitForUnlock();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudio = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (this.currentAudio === audio) this.currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (this.currentAudio === audio) this.currentAudio = null;
          reject(new Error("Audio playback failed."));
        };
        try {
          await audio.play();
        } catch (err) {
          URL.revokeObjectURL(url);
          if (this.currentAudio === audio) this.currentAudio = null;
          if ((err as Error).name === "NotAllowedError") {
            // Park the queue and ask for an unlock gesture.
            this.audioBlocked = true;
            this.cb.onAudioBlocked();
            void tryPlay();
            return;
          }
          reject(err);
        }
      };
      void tryPlay();
    });
  }

  private waitForUnlock(): Promise<void> {
    return new Promise((resolve) => {
      this.unlockResolver = resolve;
    });
  }

  unlock() {
    this.audioBlocked = false;
    const r = this.unlockResolver;
    this.unlockResolver = null;
    r?.();
  }

  stop() {
    this.queue = [];
    this.abortController?.abort();
    this.abortController = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.playing) {
      this.playing = false;
      this.cb.onStateChange(false);
    }
  }

  get isSpeaking() {
    return this.playing || this.queue.length > 0;
  }

  get isBlocked() {
    return this.audioBlocked;
  }
}
