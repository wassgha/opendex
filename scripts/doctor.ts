import { homedir } from "node:os";
import { join } from "node:path";
import { readDiagnosticReport } from "../src/main/diagnostics/report";
import { listDesktopTasks, bridgeFailure } from "../src/main/maintenance/desktop-tasks";

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes("--help")) {
    console.log("Dex Doctor: --last 3 [--codex] [--cwd /project/path]. Reads aggregate history; --codex inspects the local desktop bridge. Never starts or messages agents. Override the history directory with OPENDEX_DIAGNOSTICS_DIR.");
    return;
  }
  const base = process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32" ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const directory = process.env.OPENDEX_DIAGNOSTICS_DIR ?? join(base, "opendex", "diagnostics");
  const history = await readDiagnosticReport(directory, Number(value("--last") ?? 3));
  const localAgents = args.includes("--codex") ? await listDesktopTasks({ cwd: value("--cwd") ?? process.cwd() }).catch(bridgeFailure) : undefined;
  console.log(JSON.stringify({ history, ...(localAgents ? { localAgents } : {}), note: "CLI reports retained history only; live runtime inspection is available inside Dex." }, null, 2));
}
void main().catch(() => {
  console.error("Dex Doctor could not complete inspection. Check local file access and connector availability.");
  process.exitCode = 1;
});
