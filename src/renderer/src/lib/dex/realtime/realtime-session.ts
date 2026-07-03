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
import type {
  RealtimeStartResult,
  ToolCallEvent,
  ToolResultEvent,
} from "../../../../../main/ipc/channels";

export type RealtimeDisconnectReason = "idle" | "server" | "error" | "ended";

export interface RealtimeSessionCallbacks {
  /** Server VAD heard the user start talking (buffered playback was flushed). */
  onUserSpeechStart: () => void;
  /** The user's finished utterance, transcribed (final text — no deltas). */
  onUserTranscript: (text: string) => void;
  /** A chunk of the transcript of what the model is saying. */
  onAssistantDelta: (text: string) => void;
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
  private sessionId = "";
  private ctx: AudioContext | null = null;
  private player: StreamingPcmPlayer | null = null;
  private feed: MicPcmFeed | null = null;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Server VAD says the user is mid-sentence — the idle window doesn't count. */
  private userSpeaking = false;
  private closed = false;

  constructor(opts: {
    micStream: MediaStream;
    idleDisconnectSec: number;
    callbacks: RealtimeSessionCallbacks;
  }) {
    this.micStream = opts.micStream;
    this.idleDisconnectMs = Math.max(5, opts.idleDisconnectSec || 10) * 1000;
    this.callbacks = opts.callbacks;
  }

  /** Wire up to a session main just opened: subscribe to its notices, start
   *  the mic feed, and prepare playback. */
  async connect(start: RealtimeStartResult): Promise<void> {
    this.sessionId = start.sessionId;
    this.unsubscribe = window.opendex.onRealtimeEvent(start.sessionId, (notice) =>
      this.handleNotice(notice),
    );

    // One shared 24kHz context for both directions: playback schedules its
    // buffers natively, and createMediaStreamSource resamples the mic to it.
    const ctx = new AudioContext({ sampleRate: 24000 });
    this.ctx = ctx;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (ctx.state === "suspended") this.callbacks.onAudioBlocked();
      });
    }
    this.player = new StreamingPcmPlayer(ctx, {
      onPlaybackChange: (playing) => {
        // The follow-up window starts when the voice actually finishes
        // *playing* — audio generation ends seconds earlier than playback.
        if (!playing) this.resetIdle();
        this.callbacks.onSpeakingChange(playing);
      },
    });
    this.feed = await MicPcmFeed.create(ctx, this.micStream, (chunk) => {
      if (!this.closed) {
        window.opendex.realtimeSend(this.sessionId, { type: "audio", chunk });
      }
    });
    this.armIdleTimer();
  }

  /** Send a typed/synthetic user message and ask the model to respond. */
  sendUserText(text: string): void {
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, { type: "user-text", text });
  }

  /** Add context (task-progress notes) without requesting a response. */
  injectContext(text: string): void {
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, { type: "inject-context", text });
  }

  /** Ask the model to speak now (throttled narration during run_task). */
  requestResponse(): void {
    window.opendex.realtimeSend(this.sessionId, { type: "request-response" });
  }

  /** Answer a delegated run_task call (the model then narrates the outcome). */
  sendToolResult(toolCallId: string, name: string, output: unknown): void {
    this.resetIdle();
    window.opendex.realtimeSend(this.sessionId, {
      type: "tool-result",
      toolCallId,
      name,
      output,
    });
  }

  cancelResponse(): void {
    this.player?.flush();
    window.opendex.realtimeSend(this.sessionId, { type: "cancel-response" });
  }

  /** Real output loudness while the model speaks (for getAmplitude). */
  outputLevel(): number {
    return this.player?.outputLevel() ?? 0;
  }

  get isSpeaking(): boolean {
    return this.player?.isPlaying ?? false;
  }

  /** Resume the output context after an autoplay block (user gesture). */
  unlock(): void {
    void this.ctx?.resume();
  }

  /** Tear the session down deliberately (interrupt, mute, mode switch,
   *  unmount). Silent — onDisconnect does not fire; the caller decides what
   *  happens next. Safe to call twice. */
  close(): void {
    if (this.closed) return;
    this.teardown();
    window.opendex.realtimeEnd(this.sessionId);
  }

  private handleNotice(
    notice: Parameters<Parameters<typeof window.opendex.onRealtimeEvent>[1]>[0],
  ): void {
    if (this.closed) return;
    switch (notice.type) {
      case "audio":
        this.resetIdle();
        this.player?.enqueue(notice.chunk);
        break;
      case "speech-started":
        this.userSpeaking = true;
        this.resetIdle();
        // The server cancelled its reply on interruption; drop what's buffered.
        this.player?.flush();
        this.callbacks.onUserSpeechStart();
        break;
      case "speech-stopped":
        this.userSpeaking = false;
        this.resetIdle();
        break;
      case "user-transcript":
        this.userSpeaking = false;
        this.resetIdle();
        this.callbacks.onUserTranscript(notice.text);
        break;
      case "assistant-delta":
        this.resetIdle();
        this.callbacks.onAssistantDelta(notice.text);
        break;
      case "turn-done":
        this.resetIdle();
        this.callbacks.onTurnDone();
        break;
      case "tool-call":
        this.callbacks.onToolCall(notice.call);
        break;
      case "tool-result":
        this.callbacks.onToolResult(notice.result);
        break;
      case "run-task":
        this.callbacks.onRunTask(notice.toolCallId, notice.task);
        break;
      case "error":
        // Turn-scoped server errors (e.g. a rejected concurrent response
        // request) — log only; a dead session arrives as "closed".
        console.warn("[opendex] realtime server error:", notice.message);
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
      if (this.userSpeaking || this.player?.isPlaying) {
        this.resetIdle();
        return;
      }
      // Nobody has said anything for the whole window — hang up and return to
      // passive wake (the wake word reconnects). This idle window is the ONLY
      // thing that ends a session nobody is using, so it must always land:
      // every other exit (mute, stop, mode switch) is user-driven.
      this.teardown();
      window.opendex.realtimeEnd(this.sessionId);
      this.callbacks.onDisconnect("idle");
    }, this.idleDisconnectMs);
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
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
    void this.ctx?.close();
    this.ctx = null;
  }
}
