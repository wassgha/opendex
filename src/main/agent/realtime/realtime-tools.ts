// Builds the tool definitions a realtime session declares: every enabled skill
// whose tools return plain data goes DIRECT (the model calls it mid-conversation,
// executed in main via the realtime:tool-call IPC, permission gate included);
// image-returning skills (computer) are reachable only through run_task, which
// delegates to the pipeline agent — realtime sessions take no image input.
import { z } from "zod";
import { getRealtimeModelMeta } from "../../config/realtime-models";
import { BUILTIN_SKILLS, isSkillAvailable } from "../../../skills/registry";
import { directSkill } from "../../../skills/realtime-selection";
import { RUN_TASK_TOOL, SLEEP_TOOL } from "../../ipc/channels";
import type { OpenDexConfig } from "../../config/schema";

/** One tool declared to the realtime session, in the wire shape the normalized
 *  session config expects (JSON Schema parameters, not zod). */
export interface RealtimeToolDef {
  name: string;
  description: string;
  /** JSON Schema produced by z.toJSONSchema from the skill tool's inputSchema. */
  parameters: unknown;
}

export const runTaskInputSchema = z.object({
  task: z
    .string()
    .describe("Complete task instructions: user's question, requested browser/tab, constraints, the research plan already presented, and expected output. For research require entering search queries in the browser, clicking only links visibly presented there (never inventing, copying, pasting, typing, or directly opening source URLs), reading original sources, comparing evidence, updateResearch milestones when available, and a final report with visited source URLs and unresolved gaps. Do not ask the worker to merely open search results."),
});

const RUN_TASK_DEF: RealtimeToolDef = {
  name: RUN_TASK_TOOL,
  description:
    "Delegate a task to the desktop agent, which can see the screen, control the mouse and " +
    "keyboard, and work through multi-step jobs. Use direct controlDesktop, openApp, and quitApp (when available) for simple window, volume, app-switching, and quit-app commands; do not delegate those. Use this for looking at or " +
    "operating the computer, apps, or files — or any request you cannot complete with your " +
    "other tools. Describe the task fully and self-containedly; the agent shares none of this " +
    "conversation. Progress is shown visually; requested milestone updates may be spoken briefly. Wait for its verified final report before claiming completion.",
  parameters: z.toJSONSchema(runTaskInputSchema),
};

/** Skills whose tools a realtime session may call directly. */
export function directRealtimeSkills(config: OpenDexConfig) {
  return BUILTIN_SKILLS.filter((s) => isSkillAvailable(s, config)).map(directSkill).filter((s) => s.tools.length > 0);
}

/** The full tool list for a session: direct skill tools + run_task. run_task is
 *  only offered when the computer skill is enabled (there is nothing to
 *  delegate to otherwise — the direct tools already cover the rest). */
export function buildRealtimeToolDefs(config: OpenDexConfig): RealtimeToolDef[] {
  const defs: RealtimeToolDef[] = directRealtimeSkills(config).flatMap((skill) =>
    skill.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.inputSchema),
    })),
  );
  const delegatable = BUILTIN_SKILLS.some(
    (s) => isSkillAvailable(s, config) && s.imageResults,
  );
  if (delegatable) defs.push(RUN_TASK_DEF);
  if (getRealtimeModelMeta(config.realtime.model)?.transcribes === false) defs.push({ name: SLEEP_TOOL, description: "End the active voice conversation and return to wake-word listening when the user asks you to go to sleep. Do not call for questions or quoted text about sleep.", parameters: z.toJSONSchema(z.object({})) });
  return defs;
}
