import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Editor CLIs support goto even when an editor is already running. No shell. */
export async function openWalkthroughLocation(
  file: string, line: number,
  platform: NodeJS.Platform = process.platform,
  launch: (command: string, args: string[]) => Promise<unknown> =
    (command, args) => execute(command, args, { timeout: 8000 }),
): Promise<string | null> {
  const editors = platform === "darwin" ? [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
    "code", "cursor", "windsurf",
  ] : platform === "win32" ? [] : ["code", "cursor", "windsurf"];
  for (const editor of editors) {
    try {
      await launch(editor, ["--reuse-window", "--goto", `${file}:${line}:1`]);
      return editor;
    } catch { /* Try the next installed CLI. Never fall back to screen driving. */ }
  }
  return null;
}
