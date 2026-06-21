import { useState } from "react";
import { useConfig } from "@/lib/use-config";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS } from "./sections";

// The settings experience for the dedicated settings window: a sidebar of
// sections on the left, the active section's controls on the right. Config is
// loaded + mutated through the same IPC as the main window, and the main process
// broadcasts changes so both windows stay in sync live.
export function SettingsApp() {
  const { data, loading, setConfig, setSecret } = useConfig();
  const [active, setActive] = useState(SETTINGS_SECTIONS[0].id);

  if (loading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        <div className="font-mono text-xs uppercase tracking-[0.4em]">Settings</div>
      </div>
    );
  }

  const section =
    SETTINGS_SECTIONS.find((s) => s.id === active) ?? SETTINGS_SECTIONS[0];
  const Active = section.Component;

  return (
    <div className="flex flex-1 overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-card/30 p-3">
        <div className="px-2 py-3 text-sm font-semibold tracking-tight text-foreground">
          Settings
        </div>
        {SETTINGS_SECTIONS.map((s) => {
          const selected = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <s.Icon className="size-4 shrink-0" />
              <span className="truncate">{s.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
          <div>
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <section.Icon className="size-5 text-muted-foreground" />
              {section.label}
            </h2>
          </div>
          <div className="flex flex-col gap-4">
            <Active data={data} setConfig={setConfig} setSecret={setSecret} />
          </div>
        </div>
      </main>
    </div>
  );
}
