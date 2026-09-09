import { z } from "zod";
import { meta, TOOLS } from "./meta";
import { eligibleTricks, TrickPicker } from "./catalog";
import type { Skill, SkillExecutionContext } from "../types";

const picker = new TrickPicker();
async function available(context?: SkillExecutionContext) {
  if (!context) return [];
  let canControl = context.availableSkillIds.includes("computer"), canCapture = canControl;
  if (canControl && context.platform === "darwin") {
    const { systemPreferences } = await import("electron");
    canControl = systemPreferences.isTrustedAccessibilityClient(false);
    canCapture = systemPreferences.getMediaAccessStatus("screen") === "granted";
  }
  return eligibleTricks({ skills: context.availableSkillIds, platform: context.platform, canControl, canCapture });
}

export const tricksSkill: Skill = {
  ...meta,
  systemPrompt: `When the user says "show me something cool", "do a trick", "surprise me", "show me what you can do", or asks for another demo, call chooseTrick and PERFORM the returned recipe. Don't just describe your capabilities or stop after selecting a trick. For a list of demos call listTricks without starting one. Match a named trick to its listed ID. A request for "another" is a new selection, not a repeat.
Execute the recipe with your existing tools. The intro is optional inspiration, not a script: use at most one short, natural content-focused line for a visual demo, before or after the action. Do not announce demo selection. Recipe output is a plan, not a completed action. Keep tool calls and permissions on their normal paths; never bypass a denial, enable disabled skills, or fabricate success. Stop if a step fails or the user interrupts. For a new request, follow that request instead of continuing the demo. Let the demonstration speak for itself. Do not close with a recap of your actions or capabilities. For information demos, give the interesting finding instead. Recipe success notes are internal evidence criteria, not text to read aloud. Only perform one trick per request; don't start an endless show. Do not start recording automatically.
For "show the constellation" or "switch to orbit" use showPlayground with the requested scene; it opens or reuses the built-in interactive demo window.`,
  tools: [
    {
      name: TOOLS.listTricks, description: "List the built-in demos that are enabled and available right now. Does not run a demo.",
      inputSchema: z.object({}),
      execute: async (_input, context) => ({ tricks: (await available(context)).map(({ id, title, description }) => ({ id, title, description })) }),
    },
    {
      name: TOOLS.chooseTrick, description: "Choose one available capability demo for 'show me something cool' or 'another trick'. Returns a recipe you MUST execute using the listed tools; selection itself does not perform it. Avoids repeats within this app run.",
      inputSchema: z.object({ id: z.string().optional().describe("Optional exact trick ID from listTricks. Omit for a surprise.") }),
      execute: async ({ id }: { id?: string }, context) => {
        const choices = await available(context);
        const trick = picker.choose(choices, id);
        if (!trick) return { error: id ? "That trick is not available with the current skills and permissions." : "No tricks are available with the current skills and permissions.", available: choices.map(({ id, title }) => ({ id, title })) };
        return { status: "selected_not_performed", ...trick, next: "Execute these steps with your existing tools. Use the optional intro only if it adds interest; do not narrate selection or recap completion. Stop on error, denial, or interruption. Report completion only after the steps succeed." };
      },
    },
    {
      name: TOOLS.showPlayground, description: "Open the built-in interactive particle playground, or switch its scene. Runs locally, needs no API key. Orbit lets the user attract/repel particles; constellation connects a drifting star field. This opens a demo, not a newly generated app.",
      inputSchema: z.object({ scene: z.enum(["orbit", "constellation"]).default("orbit") }),
      execute: async ({ scene }: { scene: "orbit" | "constellation" }) => {
        const { showPlayground } = await import("../../main/demos/playground-window");
        return showPlayground(scene);
      },
    },
  ],
};
