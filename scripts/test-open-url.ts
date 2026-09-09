import { strict as assert } from "node:assert";
import { test } from "node:test";
import { openUrl } from "../src/skills/open/open-url";

function launcher() {
  const calls: unknown[][] = [];
  return {
    calls, platform: "darwin", trusted: () => true,
    openExternal: async (url: string) => { calls.push(["default", url]); },
    native: () => ({
      appPath: (name: string) => { calls.push(["resolve", name]); return "/Applications/Google Chrome.app"; },
      activateApp: (path: string) => { calls.push(["activate", path]); return 42; },
      appVisible: (pid: number) => { calls.push(["visible", pid]); return true; },
    }),
    launch: async (path: string, url: string) => { calls.push(["launch", path, url]); },
  };
}

test("a named-browser search launches its exact URL and verifies foreground without the default handler", async () => {
  const host = launcher();
  const url = "https://www.google.com/search?q=" + encodeURIComponent("today's headlines & weather");
  const result = await openUrl({ browser: "Google Chrome", url }, host);
  assert.equal(result.ok, true);
  assert.deepEqual(host.calls, [
    ["resolve", "Google Chrome"], ["launch", "/Applications/Google Chrome.app", "https://www.google.com/search?q=today%27s%20headlines%20%26%20weather"],
    ["activate", "/Applications/Google Chrome.app"], ["visible", 42],
  ]);
  assert.match(result.verification!, /search results are not verified/);
});

test("unspecified browser uses the default handler", async () => {
  const host = launcher();
  assert.equal((await openUrl({ url: "https://example.com" }, host)).ok, true);
  assert.deepEqual(host.calls, [["default", "https://example.com/"]]);
});

test("unsupported targets, missing permission, and invalid URLs perform no launch", async () => {
  for (const scenario of ["platform", "permission", "protocol", "malformed", "mailto"]) {
    const host = launcher();
    if (scenario === "platform") host.platform = "win32";
    if (scenario === "permission") host.trusted = () => false;
    const url = scenario === "protocol" ? "file:///tmp/test" : scenario === "malformed" ? "https://" : scenario === "mailto" ? "mailto:test@example.com" : "https://example.com";
    assert.ok((await openUrl({ url, browser: "Chrome" }, host)).error);
    assert.deepEqual(host.calls, []);
  }
});

test("launch and activation failures cannot report success or fall back to another browser", async () => {
  for (const phase of ["launch", "activate"] as const) {
    const host = launcher();
    if (phase === "launch") host.launch = async () => { throw new Error("launch failed"); };
    else {
      const native = host.native();
      native.activateApp = () => { throw new Error("activation failed"); };
      host.native = () => native;
    }
    const result = await openUrl({ url: "https://example.com", browser: "Chrome" }, host);
    assert.ok(result.error);
    assert.equal(result.ok, undefined);
    assert.equal(host.calls.some(c => c[0] === "default"), false);
  }
});
