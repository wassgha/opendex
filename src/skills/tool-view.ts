import type { ComponentType } from "react";

// ── Tool view model (renderer) ──────────────────────────────────────────────
// The renderer half of a tool: how its call is labelled (activity banner) and,
// optionally, how its result renders as a card in the conversation thread.
// Linked to the main-process SkillTool purely by `name` (declared in the
// skill's meta.ts). Registered from each skill's view.tsx via registerToolView.

// Where a tool's UI is being rendered, so one Card can branch on density (a full
// panel in the main window vs. a glance in the notch).
export type ToolSurface = "main" | "notch" | "overlay";

export type ToolStatus = "running" | "done" | "error";

export interface ToolViewProps {
  /** The tool's name (so a shared card like GenericCard can resolve its label). */
  name: string;
  input: unknown;
  /** null until the tool returns. */
  result: unknown;
  status: ToolStatus;
  surface: ToolSurface;
}

export interface ToolView {
  name: string;
  /** Short banner icon + label from the (possibly partial) call input. */
  label: (input: unknown) => { icon: string; label: string };
  /** Optional rich result card. Omitted → the tool is banner-only (e.g. a
   *  mouse click), so no card is rendered for it. */
  Card?: ComponentType<ToolViewProps>;
}

/** A tool call paired with its result, accumulated for the current turn. The
 *  voice state machine produces these (use-dex) and surfaces them to themes +
 *  the notch; `SessionToolInvocation` in the IPC layer mirrors this shape. */
export interface ToolInvocation {
  id: string;
  name: string;
  input: unknown;
  result: unknown;
  status: ToolStatus;
}
