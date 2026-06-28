import { TOOL_NAMES } from "../../../../../shared/tool-names";
import { registerToolView } from "../registry";
import { truncate } from "../label-utils";

// The open skill is label-only (no result cards) — opening a URL/app/path is
// best surfaced as a transient banner, not a persistent card.
registerToolView({
  name: TOOL_NAMES.openUrl,
  label: (input) => ({
    icon: "🌐",
    label: `Open ${truncate(String((input as { url?: unknown })?.url ?? ""))}`,
  }),
});

registerToolView({
  name: TOOL_NAMES.openApp,
  label: (input) => ({
    icon: "🚀",
    label: `Launch ${String((input as { name?: unknown })?.name ?? "")}`,
  }),
});

registerToolView({
  name: TOOL_NAMES.openPath,
  label: (input) => ({
    icon: "📂",
    label: `Open ${truncate(String((input as { path?: unknown })?.path ?? ""))}`,
  }),
});
