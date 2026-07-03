// Builds the tool definitions a realtime session declares: every enabled skill
// whose tools return plain data goes DIRECT (the model calls it mid-conversation,
// executed in main via the realtime:tool-call IPC, permission gate included);
// image-returning skills (computer) are reachable only through run_task, which
// delegates to the pipeline agent — realtime sessions take no image input.
import { z } from "zod";
import { BUILTIN_SKILLS, isSkillEnabled } from "../../../skills/registry";
import { RUN_TASK_TOOL } from "../../ipc/channels";
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
    .describe("Complete, self-contained task instructions for the desktop agent."),
});

const RUN_TASK_DEF: RealtimeToolDef = {
  name: RUN_TASK_TOOL,
  description:
    "Delegate a task to the desktop agent, which can see the screen, control the mouse and " +
    "keyboard, and work through multi-step jobs. Use it for anything involving looking at or " +
    "operating the computer, apps, or files — or any request you cannot complete with your " +
    "other tools. Describe the task fully and self-containedly; the agent shares none of this " +
    "conversation. While it runs you will receive progress notes; give the user brief spoken " +
    "updates. It returns a final report when done.",
  parameters: z.toJSONSchema(runTaskInputSchema),
};

/** Skills whose tools a realtime session may call directly. */
export function directRealtimeSkills(config: OpenDexConfig) {
  return BUILTIN_SKILLS.filter((s) => isSkillEnabled(s, config) && !s.imageResults);
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
    (s) => isSkillEnabled(s, config) && s.imageResults,
  );
  if (delegatable) defs.push(RUN_TASK_DEF);
  return defs;
}
