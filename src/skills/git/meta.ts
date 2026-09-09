import type { SkillMeta } from "../types";
export const meta: SkillMeta = {
  id: "git", label: "Repository git", sensitive: true,
  description: "Check the running OpenDex development repository. Pull (clean, fast-forward only) or commit already-staged changes with a fresh confirmation every time. Never stages, pushes or resets files.",
};
