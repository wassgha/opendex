import type { ComponentType } from "react";
import type { DexStatus, TranscriptTurn } from "@/lib/dex/state";

// A theme renders the ENTIRE main experience (visualization + status +
// transcript + controls). Only the global settings button and the audio-unlock
// overlay live outside the theme, in App.
export interface DexThemeProps {
  name: string;
  wakeWord: string;
  status: DexStatus;
  transcript: TranscriptTurn[];
  liveCaption: string;
  /** 0..1 voice loudness, sampled via requestAnimationFrame. */
  getAmplitude: () => number;
  isMuted: boolean;
  bargeInEnabled: boolean;
  briefingActive: boolean;
  unsupported: boolean;
  /** Manual wake mode + ready: the visualization is tap-to-talk. */
  canPushToTalk: boolean;
  onPushToTalk: () => void;
  /** Submit a typed command (the concealed text-input alternative to voice). */
  onSubmitText: (text: string) => void;
  toggleMute: () => void;
  toggleBargeIn: () => void;
  /** Open the settings panel — rendered by the theme's shared top bar. */
  onOpenSettings: () => void;
}

export interface DexThemeDef {
  id: string;
  label: string;
  description: string;
  Component: ComponentType<DexThemeProps>;
}
