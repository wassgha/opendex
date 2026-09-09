import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const executeFile = promisify(execFile);

/** Launch with argument arrays: source paths are data, never shell commands. */
export async function trySourceEditor(
  path: string,
  platform: NodeJS.Platform = process.platform,
  launch: (command: string, args: string[]) => Promise<unknown> =
    (command, args) => executeFile(command, args, { timeout: 8000 }),
): Promise<string | null> {
  const editors = platform === "darwin"
    ? ["Visual Studio Code", "Cursor", "Zed", "Windsurf", "WebStorm", "IntelliJ IDEA", "Sublime Text"]
    : platform === "win32"
      ? [] // Windows editor CLIs commonly require .cmd shell execution; use the file-manager fallback.
      : ["code", "cursor", "zed", "windsurf", "webstorm", "idea", "subl"];
  for (const editor of editors) {
    try {
      await launch(platform === "darwin" ? "/usr/bin/open" : editor,
        platform === "darwin" ? ["-a", editor, path] : [path]);
      return editor;
    } catch { /* Not installed or launch failed: try the next editor. */ }
  }
  return null;
}

export const SOURCE_URL = "https://github.com/wassgha/opendex";

/** Resolve only the running development app, never an unrelated working directory. */
export async function openDexSource(deps: {
  packaged: boolean;
  appPath: string;
  openEditor?: (path: string) => Promise<string | null>;
  openPath: (path: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
}) {
  try {
    let local = false;
    if (!deps.packaged) {
      try {
        const pkg = JSON.parse(await readFile(join(deps.appPath, "package.json"), "utf8"));
        local = pkg.name === "opendex" && (await stat(join(deps.appPath, "src/main/index.ts"))).isFile();
      } catch { /* Installed builds without source use the public repository. */ }
    }
    if (local) {
      const editor = await (deps.openEditor ?? trySourceEditor)(deps.appPath);
      if (editor) return { ok: true, opened: deps.appPath, target: "local-source-editor", editor };
      const error = await deps.openPath(deps.appPath);
      return error ? { error } : { ok: true, opened: deps.appPath, target: "local-source-folder", fallback: "No supported editor could be launched; opened the source folder instead." };
    }
    await deps.openExternal(SOURCE_URL);
    return { ok: true, opened: SOURCE_URL, target: "public-source-repository" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
