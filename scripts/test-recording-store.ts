import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecordingStore } from "../src/main/recordings/store";

const options = { sourceId: "screen:1:0", microphone: true, systemAudio: true };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "dex-recording-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new RecordingStore(directory);
}

test("chunks remain ordered, finalization waits for writes, and active clips stay out of the library", async t => {
  const store = await fixture(t);
  const entry = await store.begin(options, "video/mp4");
  assert.deepEqual(await store.list(), []);
  const writes = [1, 2, 3].map(value => store.append(entry.id, Uint8Array.of(value).buffer));
  const result = await store.finish(entry.id, 200);
  await Promise.all(writes);
  assert.deepEqual([...await readFile(store.mediaPath(entry))], [1, 2, 3]);
  assert.equal(result.status, "complete");
  assert.equal(result.bytes, 3);
  assert.equal((await store.list()).length, 1);
  if (process.platform !== "win32") assert.equal((await stat(store.mediaPath(entry))).mode & 0o777, 0o600);
});

test("cancelled setup leaves no empty recording; stale chunks cannot reach the next clip", async t => {
  const store = await fixture(t);
  const first = await store.begin(options, "video/webm");
  await store.finish(first.id, 0, true);
  assert.deepEqual(await store.list(), []);
  const second = await store.begin(options, "video/mp4");
  await assert.rejects(store.append(first.id, Uint8Array.of(1).buffer));
  await assert.rejects(store.trash(second.id, async () => {}));
  await assert.rejects(store.begin(options, "video/mp4"));
  await store.finish(second.id, 0);
});

test("an interrupted process leaves a discoverable partial video", async t => {
  const store = await fixture(t);
  const entry = await store.begin(options, "video/webm");
  await store.append(entry.id, Uint8Array.of(1, 2).buffer);
  const recovered = await new RecordingStore(store.directory).list();
  assert.equal(recovered[0].status, "interrupted");
  assert.equal(recovered[0].bytes, 2);
});

test("path traversal, unknown formats, and oversized IPC chunks are rejected", async t => {
  const store = await fixture(t);
  await assert.rejects(store.get("../../secrets"));
  await assert.rejects(store.begin(options, "text/html"));
  const entry = await store.begin(options, "video/webm");
  await assert.rejects(store.append(entry.id, new ArrayBuffer(8 * 1024 * 1024 + 1)));
  await store.finish(entry.id, 0);
});

test("deletion uses the system trash for both the media and metadata", async t => {
  const store = await fixture(t);
  const entry = await store.begin(options, "video/mp4");
  await store.append(entry.id, Uint8Array.of(1).buffer);
  await store.finish(entry.id, 100);
  const paths: string[] = [];
  await store.trash(entry.id, async path => { paths.push(path); });
  assert.deepEqual(paths, [store.mediaPath(entry), join(store.directory, `${entry.id}.json`)]);
});
