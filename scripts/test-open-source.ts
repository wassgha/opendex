import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDexSource, trySourceEditor, SOURCE_URL } from "../src/skills/open/open-source";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { buildSystemPrompt, buildRealtimeInstructions } from "../src/main/agent/system-prompt";

test("source opening selects verified checkout, falls back for installed/missing source, and preserves failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "dex-source-"));
  const calls: string[] = [];
  const deps = { openEditor: async () => null, packaged: false, appPath: root, openPath: async (path: string) => { calls.push(path); return ""; }, openExternal: async (url: string) => { calls.push(url); } };
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "opendex" }));
    await mkdir(join(root, "src/main"), { recursive: true });
    await writeFile(join(root, "src/main/index.ts"), "");
    assert.equal((await openDexSource({ ...deps, openEditor: async path => { assert.equal(path, root); return "Cursor"; } })).target, "local-source-editor");
    assert.deepEqual(calls, []);
    assert.equal((await openDexSource(deps)).target, "local-source-folder");
    assert.deepEqual(calls.splice(0), [root]);
    assert.deepEqual(await openDexSource({ ...deps, openPath: async () => "launch failed" }), { error: "launch failed" });
    assert.deepEqual(calls, []);
    assert.equal((await openDexSource({ ...deps, packaged: true })).target, "public-source-repository");
    assert.deepEqual(calls.splice(0), [SOURCE_URL]);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "unrelated" }));
    await openDexSource(deps);
    assert.deepEqual(calls.splice(0), [SOURCE_URL]);
    await rm(join(root, "package.json"));
    await openDexSource(deps);
    assert.deepEqual(calls.splice(0), [SOURCE_URL]);
    assert.deepEqual(await openDexSource({ ...deps, openExternal: async () => { throw new Error("browser failed"); } }), { error: "browser failed" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const build of [buildSystemPrompt, buildRealtimeInstructions]) {
  test(`${build.name}: own source meaning survives custom persona and greetings, respects access`, () => {
    const config = mergeConfig(DEFAULT_CONFIG, { assistant: { persona: "Speak briefly." } });
    for (const briefing of [false, true]) {
      const prompt = build({ config, briefing });
      assert.match(prompt, /"open your code"/);
      assert.match(prompt, /Call openDexSource directly/);
      assert.match(prompt, /Requests explicitly about model internals retain their literal meaning/);
      const disabled = build({ config: mergeConfig(config, { skills: { enabled: { open: false } } }), briefing });
      assert.match(disabled, /Open apps & URLs is disabled/);
      assert.doesNotMatch(disabled, /Call openDexSource directly/);
      const denied = build({ config: mergeConfig(config, { skills: { permissions: { open: "never" } } }), briefing });
      assert.match(denied, /permission is set to Never/);
      assert.doesNotMatch(denied, /Call openDexSource directly/);
    }
  });
}


test("editor selection skips missing editors and stops after success with a literal folder argument", async () => {
  const calls: [string, string[]][] = [];
  const path = "/tmp/Dex project;$(example)";
  const editor = await trySourceEditor(path, "darwin", async (command, args) => {
    calls.push([command, args]);
    if (args[1] !== "Cursor") throw new Error("not installed");
  });
  assert.equal(editor, "Cursor");
  assert.deepEqual(calls, [["/usr/bin/open", ["-a", "Visual Studio Code", path]], ["/usr/bin/open", ["-a", "Cursor", path]]]);
  assert.equal(await trySourceEditor(path, "darwin", async () => { throw new Error("unavailable"); }), null);
});
