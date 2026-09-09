import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PlaybackCaptions } from "../src/renderer/src/lib/dex/realtime/playback-captions";

test("generation ahead of playback stays queued, including while the audio clock pauses", () => {
  const captions = new PlaybackCaptions();
  captions.enqueue("First sentence.", 1);
  captions.enqueue("First sentence. Another sentence.", 4);
  assert.equal(captions.advance(0), undefined);
  assert.equal(captions.advance(1), "First sentence.");
  assert.equal(captions.advance(1), undefined);
  assert.equal(captions.advance(3.9), undefined);
  assert.equal(captions.advance(4), "First sentence. Another sentence.");
});

test("interruption discards unheard captions; the next response starts cleanly", () => {
  const captions = new PlaybackCaptions();
  captions.enqueue("Unheard ending", 20);
  captions.clear();
  captions.enqueue("New answer", 2);
  assert.equal(captions.advance(2), "New answer");
  assert.equal(captions.advance(30), undefined);
});

test("a delayed UI tick coalesces due snapshots without skipping future audio", () => {
  const captions = new PlaybackCaptions();
  captions.enqueue("One", 1);
  captions.enqueue("One two", 2);
  captions.enqueue("One two three", 3);
  assert.equal(captions.advance(2.5), "One two");
  assert.equal(captions.advance(3), "One two three");
});
