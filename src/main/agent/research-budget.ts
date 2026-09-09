import { START_RESEARCH_TOOL } from "./research-start";
import { TOOLS } from "../../skills/research/meta";
type Step = { toolCalls: Array<{ toolName: string }> };
export function researchStepLimit(steps: Step[]) {
  return steps.some(step => step.toolCalls.some(call => [TOOLS.updateResearch, START_RESEARCH_TOOL].includes(call.toolName))) ? 96 : 40;
}
