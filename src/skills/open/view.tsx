import { TOOLS } from "./meta";
import { registerToolView } from "../tool-registry";
import { truncate } from "../label-utils";

// The open skill is label-only (no result cards) — opening a URL/app/path is
// best surfaced as a transient banner, not a persistent card.
registerToolView({
  name: TOOLS.openUrl,
  label: (input) => ({
    icon: "🌐",
    label: `Open ${truncate(String((input as { url?: unknown })?.url ?? ""))}`,
  }),
});

registerToolView({
  name: TOOLS.openApp,
  label: (input) => ({
    icon: "🚀",
    label: `Launch ${String((input as { name?: unknown })?.name ?? "")}`,
  }),
});

registerToolView({
  name: TOOLS.openPath,
  label: (input) => ({
    icon: "📂",
    label: `Open ${truncate(String((input as { path?: unknown })?.path ?? ""))}`,
  }),
});
