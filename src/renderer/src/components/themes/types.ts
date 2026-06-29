import type { ComponentType } from "react";
import type { DexStatus, TranscriptTurn } from "@/lib/dex/state";
import type { ToolInvocation } from "@skills/tool-view";

// A theme renders the ENTIRE main experience (visualization + status +
// transcript + controls). Only the global settings button and the audio-unlock
// overlay live outside the theme, in App.
export interface DexThemeProps {
  name: string;
  wakeWord: string;
  status: DexStatus;
  transcript: TranscriptTurn[];
  liveCaption: string;
  /** Assistant text spoken so far this turn — lags the token stream so display
   *  can stay in sync with the voice rather than racing ahead. */
  spokenCaption: string;
  /** 0..1 voice loudness, sampled via requestAnimationFrame. */
  getAmplitude: () => number;
  /** Tool calls + results this session — render result cards via <ToolCardLayer>. */
  toolInvocations: ToolInvocation[];
  isMuted: boolean;
  briefingActive: boolean;
  unsupported: boolean;
  /** Manual wake mode + ready: the visualization is tap-to-talk. */
  canPushToTalk: boolean;
  onPushToTalk: () => void;
  /** Submit a typed command (the concealed text-input alternative to voice). */
  onSubmitText: (text: string) => void;
  toggleMute: () => void;
  /** Open the settings panel — rendered by the theme's shared top bar. */
  onOpenSettings: () => void;
  /** Collapse the main window into the slim notch bar. */
  onMinimize: () => void;
  /** Dismiss the current turn and start a fresh conversation. */
  onNewConversation: () => void;
}

// A theme is fully self-contained: its folder (src/.../themes/<id>/index.tsx)
// default-exports this definition — identity, the full-experience Component, and
// a small static Preview glyph for the picker. Drop a new folder with an
// index.tsx that default-exports a DexThemeDef and it's auto-registered.
export interface DexThemeDef {
  id: string;
  label: string;
  description: string;
  /** Sort order in the picker (lower first). Defaults to alphabetical by label. */
  order?: number;
  /** The whole main experience. */
  Component: ComponentType<DexThemeProps>;
  /** A small, audio-free glyph shown in the theme picker. */
  Preview: ComponentType;
  /** Optional: the theme's own status indicator, used by the notch in place of
   *  the default status dot (e.g. editorial's dot-matrix). */
  StatusIndicator?: ComponentType<{ status: DexStatus }>;
}
