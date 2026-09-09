import { PlaybackCaptions } from "./playback-captions";
import { voiceErrorFeedback } from "./voice-error";
import { InputPreview } from "./input-preview";
import { EchoReferenceOutput } from "./echo-reference-output";
import { configureEchoCancellation } from "./echo-cancellation";
import { replayWakeAudio, type WakeAudio } from "../engines/wake-audio";
// The renderer's handle on one realtime speech-to-speech session. The
// WebSocket + tool execution live in MAIN (session-host.ts); this class owns
// the audio path — mic PCM frames up, the model's voice back through the
// streaming player — plus the idle-disconnect window, and translates the
// session's IPC notices into the narrow callback surface useDex consumes.
//
// Barge-in here is the server's VAD, not the wake-word monitor: when the model
// hears the user start talking it cancels its reply server-side, and the
// `speech-started` notice flushes whatever audio was already buffered locally.
import { StreamingPcmPlayer } from "./pcm-player";
import { MicPcmFeed } from "./pcm-capture";
import { isSleepCommand } from "../sleep-command";
import type {
  RealtimeStartResult,
  ToolCallEvent,
  ToolResultEvent,
} from "../../../../../main/ipc/channels";

export type RealtimeDisconnectReason = "idle" | "server" | "error" | "ended" | "sleep" | "new-session";

export interface RealtimeSessionCallbacks {
  /** Detection feedback never authorizes cancellation or tool execution. */
  onFeedbackChange?: (text: string) => void;
  onWaitingForResponse?: () => void;
  onVoiceError?: (message: string) => void;
  /** Server VAD heard the user start talking (buffered playback was flushed). */
  onUserSpeechStart: () => void;
  /** The user's finished utterance, transcribed (final text — no deltas). */
  onUserTranscript: (text: string) => void;
  /** Unconfirmed local estimate for display only. */
  onInputPreview?: (text: string) => void;
  /** A chunk of the transcript of what the model is saying. */
  onAssistantDelta: (text: string) => void;
  /** Cumulative caption released against the local playback clock. */
  onPlaybackCaption?: (text: string) => void;
  /** The model finished a response turn. */
  onTurnDone: () => void;
  /** The model's voice started/stopped coming out of the speakers. */
  onSpeakingChange: (speaking: boolean) => void;
  /** Any tool the model invoked (direct or run_task) — for the activity UI. */
  onToolCall: (call: ToolCallEvent) => void;
  /** A direct tool finished in main — for result cards. */
  onToolResult: (result: ToolResultEvent) => void;
  /** The model delegated a task: drive the pipeline agent and answer with
   *  sendToolResult. */
  onRunTask: (toolCallId: string, task: string) => void;
  /** The session is gone (idle window, gateway session limits, error). Not
   *  fired for close() — the caller owns its own next state there. */
  onDisconnect: (reason: RealtimeDisconnectReason) => void;
  /** Autoplay policy blocked the output context; call unlock() on a gesture. */
  onAudioBlocked: () => void;
}

export class RealtimeVoiceSession {
  private readonly micStream: MediaStream;
  private readonly idleDisconnectMs: number;
  private readonly callbacks: RealtimeSessionCallbacks;
  sessionId = "";
  private ctx: AudioContext | null = null;
  private player: StreamingPcmPlayer | null = null;
  private echoOutput: EchoReferenceOutput | null = null;
  private feed: MicPcmFeed | null = null;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Server VAD says the user is mid-sentence — the idle window doesn't count. */
  private userSpeaking = false;
  private responsePending = false;
  private wakeReplayPending = false;
  private inputState: "hearing" | "processing" | null = null;
  private responseWatchdog: ReturnType<typeof setTimeout> | null = null;
  private responseHint: ReturnType<typeof setTimeout> | null = null;
  private pendingTools = new Set<string>();
  private closed = false;
  private wakeWord: string;
  private captions = new PlaybackCaptions();
  private captionText = "";
  private inputPreview: InputPreview | null = null;
  private captionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    micStream: MediaStream;
    idleDisconnectSec: number;
    wakeWord?: string;
    callbacks: RealtimeSessionCallbacks;
  }) {
    this.micStream = opts.micStream;
    this.wakeWord = opts.wakeWord ?? "dex";
    this.idleDisconnectMs = Math.max(5, opts.idleDisconnectSec || 10) * 1000;
    this.callbacks = opts.callbacks;
  }

  /** Wire up to a session main just opened: subscribe to its notices, start
   *  the mic feed, and prepare playback. */
  async connect(start: RealtimeStartResult, initialAudio?: WakeAudio, initialContext?: string): Promise<void> {
    this.sessionId = start.sessionId;
    this.unsubscribe = window.opendex.onRealtimeEvent(start.sessionId, (notice) =>
      this.handleNotice(notice),
    );
    this.inputPreview = new InputPreview(text => {
      if (!this.closed) this.callbacks.onInputPreview?.(text);
    });
    // Reuses the wake engine's cached model; first download never blocks audio.
    void this.inputPreview.start().catch(() => {
      this.inputPreview?.close();
      this.inputPreview = null;
    });

    const track = this.micStream.getAudioTracks()[0];
    if (track) {
      const processing = await configureEchoCancellation(track);
      window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "microphone-processing", reason: JSON.stringify(processing) });
    }
    if (this.closed) return;

    // One shared 24kHz context for both directions: playback schedules its
    // buffers natively, and createMediaStreamSource resamples the mic to it.
    const ctx = new AudioContext({ sampleRate: 24000 });
    this.ctx = ctx;
    this.captionTimer = setInterval(() => {
      const text = this.captions.advance(ctx.currentTime);
      if (text !== undefined) this.callbacks.onPlaybackCaption?.(text);
    }, 50);
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (ctx.state === "suspended") this.callbacks.onAudioBlocked();
      });
    }
    this.echoOutput = await EchoReferenceOutput.create(ctx, this.callbacks.onAudioBlocked);
    if (this.closed) { this.echoOutput.dispose(); this.echoOutput = null; return; }
    window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "echo-reference-ready", reason: "local WebRTC playback; microphone stays live" });
    this.player = new StreamingPcmPlayer(ctx, {
      onPlaybackChange: (playing) => {
        if (playing) this.echoOutput?.unlock();
        else this.echoOutput?.pause();
        window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: playing ? "playback-start" : "playback-stop" });
        // The follow-up window starts when the voice actually finishes
        // *playing* — audio generation ends seconds earlier than playback.
        if (!playing) this.resetIdle();
        this.callbacks.onSpeakingChange(playing);
        this.refreshFeedback();
        this.watchResponse();
      },
    }, this.echoOutput.input);
    if (initialContext) this.injectContext(initialContext);
    if (initialAudio?.pcm.length) {
      const replay = replayWakeAudio(initialAudio);
      window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "wake-audio-replay", reason: `${initialAudio.pcm.length / initialAudio.sampleRate}s original audio; no Vosk command text` });
      this.responsePending = true;
      this.wakeReplayPending = true;
      // Enqueue original speech before the live microphone, preserving order.
      for (let offset = 0; offset < replay.length; offset += 24000) {
        window.opendex.realtimeSend(this.sessionId, { type: "audio", chunk: replay.slice(offset, offset + 24000).buffer });
      }
      initialAudio.pcm.fill(0);
    }
    this.feed = await MicPcmFeed.create(ctx, this.micStream, (chunk, speechProbability) => {
      if (!this.closed) {
        window.opendex.realtimeSend(this.sessionId, { type: "audio", chunk, speechProbability });
      }
    }, open => {
      // Local classification gives feedback before the network round trip.
      // It must never flush playback or authorize a new turn.
      if (!this.closed && !this.inputState && !this.responsePending && !this.player?.isPlaying && !this.pendingTools.size) {
        this.callbacks.onFeedbackChange?.(open ? "Speech detected" : "Listening to you");
      }
      window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "local-speech-gate", reason: open ? "diagnostic-only: speech-likely" : "diagnostic-only: speech-unlikely" });
    }, stats => {
      if (!this.closed) window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "microphone-detection", reason: JSON.stringify({ ...stats, playback: this.player?.isPlaying ?? false }) });
    }, () => this.player?.isPlaying ?? false, undefined, frame => {
      // Avoid showing Dex's own voice as user input. Server detection can
      // enable preview during double-talk without authorizing interruption.
      if (!this.player?.isPlaying || this.inputState) this.inputPreview?.feed(frame);
    });
    if (this.closed) { this.feed.stop(); this.feed = null; return; }
    window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "local-speech-gate", reason: "ready: continuous echo-cancelled audio; server turn detection; per-frame playback evidence" });
    this.armIdleTimer();
    this.refreshFeedback();
    this.watchResponse();
  }

  /** Send a typed/synthetic user message and ask the model to respond. */
  sendUserText(text: string): void {
    this.responsePending = true;
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, { type: "user-text", text });
    this.callbacks.onWaitingForResponse?.();
    this.refreshFeedback();
    this.watchResponse();
  }

  /** Add context (task-progress notes) without requesting a response. */
  injectContext(text: string): void {
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, { type: "inject-context", text });
  }

  /** Ask the model to speak now (throttled narration during run_task). */
  requestResponse(): void {
    this.responsePending = true;
    window.opendex.realtimeSend(this.sessionId, { type: "request-response" });
    this.refreshFeedback();
    this.watchResponse();
  }
  reportResearchProgress(toolCallId: string, text: string): void {
    if (!this.closed) window.opendex.realtimeSend(this.sessionId, { type: "research-progress", toolCallId, text });
  }

  /** Answer a delegated run_task call (the model then narrates the outcome). */
  sendToolResult(toolCallId: string, name: string, output: unknown): void {
    this.pendingTools.delete(toolCallId);
    this.responsePending = true;
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, {
      type: "tool-result",
      toolCallId,
      name,
      output,
    });
    this.refreshFeedback();
    this.watchResponse();
  }

  cancelResponse(): void {
    this.inputPreview?.reset();
    this.responsePending = false;
    this.wakeReplayPending = false;
    this.inputState = null;
    this.userSpeaking = false;
    this.clearResponseWatchdog();
    this.captions.clear();
    this.captionText = "";
    this.player?.flush();
    window.opendex.realtimeSend(this.sessionId, { type: "cancel-response" });
    this.refreshFeedback();
  }

  /** Real output loudness while the model speaks (for getAmplitude). */
  outputLevel(): number {
    return this.player?.outputLevel() ?? 0;
  }

  get isSpeaking(): boolean {
    return this.player?.isPlaying ?? false;
  }

  get isWaiting(): boolean {
    return this.responsePending || this.pendingTools.size > 0;
  }

  /** Resume the output context after an autoplay block (user gesture). */
  unlock(): void {
    this.echoOutput?.unlock();
    void this.ctx?.resume();
  }

  /** Tear the session down deliberately (interrupt, mute, mode switch,
   *  unmount). Silent — onDisconnect does not fire; the caller decides what
   *  happens next. Safe to call twice. */
  close(): void {
    if (this.closed) return;
    window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "client-close", reason: "explicit-close" });
    this.teardown();
    window.opendex.realtimeEnd(this.sessionId);
  }

  sleep(): void {
    if (this.closed) return;
    this.close();
    this.callbacks.onDisconnect("sleep");
  }

  private handleNotice(
    notice: Parameters<Parameters<typeof window.opendex.onRealtimeEvent>[1]>[0],
  ): void {
    if (this.closed) return;
    switch (notice.type) {
      case "input-state":
        if (notice.state === "idle" || notice.state === "retry") this.inputPreview?.reset();
        this.inputState = notice.state === "hearing" || notice.state === "processing" ? notice.state : null;
        this.userSpeaking = this.inputState !== null;
        if (!this.inputState) {
          // A rejected wake replay must not keep the session alive forever.
          if (this.wakeReplayPending) this.responsePending = false;
          this.wakeReplayPending = false;
        }
        this.resetIdle();
        this.refreshFeedback();
        this.watchResponse();
        if (notice.state === "retry" && !this.player?.isPlaying && !this.pendingTools.size) {
          this.callbacks.onFeedbackChange?.("Didn't catch that · please try again");
        }
        break;
      case "new-session":
        this.close();
        this.callbacks.onDisconnect("new-session");
        break;
      case "sleep":
        this.sleep();
        break;
      case "audio":
        this.resetIdle();
        this.player?.enqueue(notice.chunk);
        this.clearResponseWatchdog();
        break;
      case "speech-started":
        this.inputState = "hearing";
        this.userSpeaking = true;
        this.resetIdle();
        window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "playback-interrupted", reason: this.player?.isPlaying ? "speech-during-playback" : "speech-without-playback" });
        // Main confirmed the interruption and cancelled generation; drop buffered playback.
        this.captions.clear();
        this.captionText = "";
        this.player?.flush();
        this.callbacks.onUserSpeechStart();
        this.refreshFeedback();
        this.clearResponseWatchdog();
        break;
      case "speech-stopped":
        this.wakeReplayPending = false;
        this.inputState = null;
        this.userSpeaking = false;
        this.responsePending = true;
        this.resetIdle();
        this.callbacks.onWaitingForResponse?.();
        this.refreshFeedback();
        this.watchResponse();
        break;
      case "user-transcript":
        this.inputPreview?.reset();
        this.userSpeaking = false;
        this.resetIdle();
        this.callbacks.onUserTranscript(notice.text);
        if (isSleepCommand(notice.text, this.wakeWord)) this.sleep();
        break;
      case "assistant-delta":
        this.resetIdle();
        this.callbacks.onAssistantDelta(notice.text);
        this.captionText += notice.text;
        this.captions.enqueue(this.captionText, this.player?.queuedUntil ?? this.ctx?.currentTime ?? 0);
        this.watchResponse();
        break;
      case "turn-done":
        this.responsePending = false;
        this.resetIdle();
        this.callbacks.onTurnDone();
        this.captionText = "";
        this.refreshFeedback();
        this.clearResponseWatchdog();
        break;
      case "tool-call":
        this.pendingTools.add(notice.call.toolCallId);
        this.resetIdle();
        this.callbacks.onToolCall(notice.call);
        this.refreshFeedback();
        this.clearResponseWatchdog();
        break;
      case "tool-result":
        this.pendingTools.delete(notice.result.toolCallId);
        this.responsePending = true;
        this.resetIdle();
        this.callbacks.onToolResult(notice.result);
        this.refreshFeedback();
        this.watchResponse();
        break;
      case "run-task":
        this.callbacks.onRunTask(notice.toolCallId, notice.task);
        break;
      case "error":
        this.responsePending = false;
        // Surface a failed turn and release its waiting state; a fresh wake
        // opens a new session without replaying a potentially completed action.
        console.warn("[opendex] realtime server error:", notice.message);
        this.clearResponseWatchdog();
        this.callbacks.onVoiceError?.(voiceErrorFeedback(notice.message, this.wakeWord));
        this.teardown();
        window.opendex.realtimeEnd(this.sessionId);
        this.callbacks.onDisconnect("error");
        break;
      case "closed": {
        const reason = notice.reason === "ended" ? "server" : notice.reason;
        this.teardown();
        this.callbacks.onDisconnect(reason);
        break;
      }
      default:
        break;
    }
  }

  private refreshFeedback(): void {
    if (this.closed) return;
    this.callbacks.onFeedbackChange?.(
      this.inputState === "hearing" ? "Speech detected"
        : this.inputState === "processing" ? "Understanding…"
        : this.player?.isPlaying ? "Speaking · mic is on"
        : this.pendingTools.size ? "Working on your request"
        : this.responsePending ? "Preparing a reply…"
        : "Listening to you",
    );
  }

  private clearResponseWatchdog(): void {
    if (this.responseWatchdog) clearTimeout(this.responseWatchdog);
    if (this.responseHint) clearTimeout(this.responseHint);
    this.responseWatchdog = this.responseHint = null;
  }

  private watchResponse(): void {
    this.clearResponseWatchdog();
    if (this.closed || !this.responsePending || this.userSpeaking || this.player?.isPlaying || this.pendingTools.size) return;
    this.responseHint = setTimeout(() => this.callbacks.onFeedbackChange?.("Reply is taking longer than usual…"), 8000);
    this.responseWatchdog = setTimeout(() => {
      // No automatic command replay: the previous turn may have had effects.
      this.callbacks.onVoiceError?.(voiceErrorFeedback("Voice reply timed out", this.wakeWord));
      this.teardown();
      window.opendex.realtimeEnd(this.sessionId);
      this.callbacks.onDisconnect("error");
    }, 30000);
  }

  private armIdleTimer(): void {
    this.resetIdle();
  }

  private resetIdle(): void {
    if (this.closed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // Never hang up on someone mid-sentence or while the voice is still
      // coming out of the speakers — restart the window instead. (Matters at
      // the short default: a long user question or a long reply's playback
      // both outlast it.)
      if (this.userSpeaking || this.player?.isPlaying || this.responsePending || this.pendingTools.size > 0) {
        this.resetIdle();
        return;
      }
      // Nobody has said anything for the whole window — hang up and return to
      // passive wake (the wake word reconnects). This idle window is the ONLY
      // thing that ends a session nobody is using, so it must always land:
      // every other exit (mute, stop, mode switch) is user-driven.
      window.opendex.realtimeSend(this.sessionId, { type: "diagnostic", event: "client-close", reason: "idle" });
      this.teardown();
      window.opendex.realtimeEnd(this.sessionId);
      this.callbacks.onDisconnect("idle");
    }, this.idleDisconnectMs);
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    this.inputPreview?.close();
    this.inputPreview = null;
    this.clearResponseWatchdog();
    if (this.captionTimer) clearInterval(this.captionTimer);
    this.captionTimer = null;
    this.captions.clear();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.feed?.stop();
    this.feed = null;
    this.player?.dispose();
    this.player = null;
    this.echoOutput?.dispose();
    this.echoOutput = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
