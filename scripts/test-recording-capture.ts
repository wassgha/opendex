import { strict as assert } from "node:assert";
import { test } from "node:test";
import { acquireCapture } from "../src/renderer/src/lib/recordings/acquire-capture";

function capture() {
  let stopped = false;
  return { stream: { getTracks: () => [{ stop: () => { stopped = true; } }] } as unknown as MediaStream, stopped: () => stopped };
}
test("cancelling a permission prompt releases a stream that arrives afterward", async () => {
  const controller = new AbortController();
  let resolve!: (stream: MediaStream) => void;
  const pending = acquireCapture(new Promise(r => { resolve = r; }), controller.signal, "Screen");
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  const late = capture(); resolve(late.stream);
  await Promise.resolve();
  assert.equal(late.stopped(), true);
});
test("a capture timeout rejects and releases late resources", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve!: (stream: MediaStream) => void;
  const pending = acquireCapture(new Promise(r => { resolve = r; }), new AbortController().signal, "Screen");
  const rejected = assert.rejects(pending, /thirty seconds/);
  t.mock.timers.tick(30000); await rejected;
  const late = capture(); resolve(late.stream); await Promise.resolve();
  assert.equal(late.stopped(), true);
});
test("successful acquisition transfers track ownership without stopping it", async () => {
  const source = capture();
  const controller = new AbortController();
  assert.equal(await acquireCapture(Promise.resolve(source.stream), controller.signal, "Screen"), source.stream);
  controller.abort();
  assert.equal(source.stopped(), false);
});
