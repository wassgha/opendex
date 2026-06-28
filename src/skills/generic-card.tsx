import { getToolView } from "./tool-registry";
import type { ToolViewProps } from "./tool-view";

// Fallback result card a skill's view.tsx can opt into for a tool that has no
// bespoke card. Styled purely with theme tokens (bg-card / border-border /
// text-*) so it adapts to every theme. On the notch surface it shrinks to a
// single label + status line.
export function GenericCard({ name, input, result, status, surface }: ToolViewProps) {
  const { icon, label } = getToolView(name).label(input);

  if (surface === "notch") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-foreground/80">
        <span aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
        {status === "running" && <span className="text-muted-foreground">…</span>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-card/80 p-3 text-card-foreground shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
        {status === "running" && (
          <span className="ml-auto text-xs text-muted-foreground">running…</span>
        )}
        {status === "error" && (
          <span className="ml-auto text-xs text-destructive">failed</span>
        )}
      </div>
      {result != null && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {safeStringify(result)}
        </pre>
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
