// Resolve Electron once before test workers import it concurrently. On a fresh
// install Electron can download its binary on first require; concurrent extraction
// races on the same directory. This does not launch the desktop application.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require("electron");
const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(new URL("./", import.meta.url))
  .filter(name => /^test-.*\.ts$/.test(name))
  .sort()
  .map(name => `scripts/${name}`);
const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--test", ...files], {
  cwd: root, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
