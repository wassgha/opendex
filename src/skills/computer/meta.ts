import type { SkillMeta } from "../types";

export const TOOLS = {
  captureScreen: "captureScreen",
  click: "click",
  moveMouse: "moveMouse",
  drag: "drag",
  typeText: "typeText",
  pressKeys: "pressKeys",
  scroll: "scroll",
  wait: "wait",
} as const;

export const meta: SkillMeta = {
  id: "computer",
  label: "Control the computer",
  description:
    "Let the assistant see the screen and control the mouse & keyboard to operate apps. Needs Screen Recording + Accessibility permissions.",
  sensitive: true,
  optIn: true,
  // Screenshots flow back to the model as images — realtime sessions can't take
  // those, so this skill is only reachable there via run_task delegation.
  imageResults: true,
};
