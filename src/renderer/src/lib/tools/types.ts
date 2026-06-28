import type { ComponentType } from "react";

// Where a tool's UI is being rendered. Lets a single Card branch on density
// (full panel in the main window, a glance in the notch) — see the locked
// decision in the tool-skill-registry plan.
export type ToolSurface = "main" | "notch" | "overlay";

export type ToolStatus = "running" | "done" | "error";

// Props passed to a tool's result Card. Mirrors assistant-ui's
// ToolCallMessagePartComponent contract (input/result/status), minus the
// runtime coupling — our data arrives over IPC as plain ToolInvocations.
export interface ToolViewProps {
  /** The tool's name (so a shared card like GenericCard can resolve its label). */
  name: string;
  input: unknown;
  /** null until the tool returns. */
  result: unknown;
  status: ToolStatus;
  surface: ToolSurface;
}

// The renderer half of a tool: how its call is labelled (banner) and,
// optionally, how its result renders as a card. Linked to the main-process
// SkillTool purely by `name` (see src/shared/tool-names.ts).
export interface ToolView {
  name: string;
  /** Short banner icon + label from the (possibly partial) call input. */
  label: (input: unknown) => { icon: string; label: string };
  /** Optional rich result card. Omitted → the tool is banner-only (e.g. a
   *  mouse click), so no card is rendered for it. */
  Card?: ComponentType<ToolViewProps>;
}
