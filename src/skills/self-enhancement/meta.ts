import type { SkillMeta } from "../types";
export const meta: SkillMeta = {
  id: "self-enhancement", label: "Self-enhancement",
  description: "Let Dex start a local Codex implementation task when a request needs a missing feature or repair. Opens a task that can edit Dex source. Ask previews each request; Always permits automatic dispatch. Does not install or restart Dex.",
  sensitive: true, optIn: true,
};
