import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
const exec = promisify(execFile);

export function parseStatus(raw: string) {
  const entries = raw.split("\0");
  const header = entries.shift() ?? "";
  const branchInfo = header.replace(/^## /, "");
  const branch = branchInfo.split("...")[0].replace(/ \[.*$/, "").replace(/^(No commits yet on|Initial commit on) /, "");
  const modified: string[] = [], untracked: string[] = [], staged: string[] = [], conflicts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    if (!row) continue;
    const xy = row.slice(0, 2), path = row.slice(3);
    if (xy === "??") untracked.push(path);
    else {
      modified.push(path);
      if (xy[0] !== " " && xy[0] !== "?") staged.push(path);
      if (xy.includes("U") || xy === "AA" || xy === "DD") conflicts.push(path);
    }
    if (/[RC]/.test(xy)) i++; // -z emits destination then a separate original name.
  }
  return { branch, detached: branchInfo.startsWith("HEAD ("),
    upstreamConfigured: branchInfo.includes("..."),
    ahead: Number(header.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(header.match(/behind (\d+)/)?.[1] ?? 0),
    modified, untracked, staged, conflicts };
}

export class GitRepository {
  private busy = false;
  constructor(private source: () => Promise<{ packaged: boolean; appPath: string }>) {}
  private async git(root: string, args: string[], signal?: AbortSignal) {
    // No shell, arbitrary arguments, interactive credentials or raw stderr projection.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_SSH_COMMAND: "ssh -oBatchMode=yes", GIT_ASKPASS: "", SSH_ASKPASS: "" });
    try {
      const result = await exec("git", args, {
        cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024, signal,
      });
      return result.stdout;
    } catch (error) {
      const e = error as { code?: string; stderr?: string; killed?: boolean; name?: string };
      if (e.name === "AbortError" || e.killed) throw new Error("Git was interrupted or timed out. Check code status before retrying; an action may have partially completed.");
      if (e.code === "ENOENT") throw new Error("Git is not installed or is unavailable on the app's PATH.");
      const message = e.stderr ?? "";
      if (/Authentication|Permission denied|could not read Username|Host key verification/.test(message)) throw new Error("Git authentication or access failed. Configure repository credentials outside Dex, then check status.");
      if (/identity unknown|unable to auto-detect email/.test(message)) throw new Error("Configure your git user.name and user.email before committing.");
      throw new Error("Git failed. Check repository access, upstream, locks and local git configuration outside Dex. No success was confirmed.");
    }
  }
  private async root(signal?: AbortSignal) {
    const source = await this.source();
    if (source.packaged || !isAbsolute(source.appPath)) throw new Error("Git requires the running OpenDex development checkout; installed builds have no source repository.");
    const root = await realpath(source.appPath);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (pkg.name !== "opendex" || !(await stat(join(root, "src/main/index.ts"))).isFile()) throw new Error("The running OpenDex source checkout could not be verified.");
    if (await realpath((await this.git(root, ["rev-parse", "--show-toplevel"], signal)).trim()) !== root) throw new Error("OpenDex must be the git repository root.");
    return root;
  }
  private async snapshot(root: string, signal?: AbortSignal) {
    const raw = await this.git(root, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], signal);
    return { ...parseStatus(raw), trackingNote: "Ahead/behind reflects locally cached upstream refs; status does not fetch." };
  }
  async status(signal?: AbortSignal) {
    try { return { ok: true as const, ...await this.snapshot(await this.root(signal), signal) }; }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Repository status unavailable." }; }
  }
  async action(action: "pull" | "commit", message?: string, signal?: AbortSignal) {
    if (this.busy) return { error: "A git action is already running. Check status when it finishes." };
    this.busy = true;
    let completed = false;
    try {
      const root = await this.root(signal), before = await this.snapshot(root, signal);
      const gitDir = (await this.git(root, ["rev-parse", "--absolute-git-dir"], signal)).trim();
      for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
        const pending = await stat(join(gitDir, marker)).then(() => true, error => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
        if (pending) throw new Error("Finish the pending merge, rebase or cherry-pick outside Dex before another git action.");
      }
      if (before.detached || before.conflicts.length) throw new Error("Resolve detached HEAD or conflicts outside Dex before changing the repository.");
      if (action === "pull") {
        if (before.modified.length || before.untracked.length) throw new Error("Pull requires a clean checkout, including no untracked files. Dex will not stash or discard changes.");
        if (!before.upstreamConfigured) throw new Error("Configure a branch upstream outside Dex before pulling.");
        await this.git(root, ["pull", "--ff-only", "--no-rebase", "--no-autostash", "--recurse-submodules=no"], signal);
      } else {
        if (!message?.trim() || message.length > 500 || /[\r\n\0]/.test(message)) throw new Error("Provide a single-line commit message of 1–500 characters.");
        if (!before.staged.length) throw new Error("Nothing is staged. Stage the intended files outside Dex first; Dex never stages automatically.");
        await this.git(root, ["commit", "-m", message], signal);
      }
      completed = true;
      return { ok: true, action, head: (await this.git(root, ["rev-parse", "--short", "HEAD"], signal)).trim(), status: await this.snapshot(root, signal) };
    } catch (error) {
      return { error: completed ? "Git action completed, but status verification failed. Check code status before retrying." : error instanceof Error ? error.message : "Git action failed." };
    } finally { this.busy = false; }
  }
}
