import { strict as assert } from "node:assert";
import { test } from "node:test";
import { acquireLiveMicrophone } from "../src/renderer/src/lib/dex/live-microphone";

function stream(state = "live") {
  const track = { readyState: state, stop() { this.readyState = "ended"; } };
  return { track, media: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

test("voice connection reacquires a missing or released microphone", async () => {
  for (const current of [null, stream("ended").media]) {
    const fresh = stream();
    assert.equal(await acquireLiveMicrophone(current, async () => fresh.media, () => true), fresh.media);
  }
});

test("a live microphone is reused without another capture", async () => {
  const live = stream();
  assert.equal(await acquireLiveMicrophone(live.media, async () => { throw new Error("unexpected capture"); }, () => true), live.media);
});

test("pausing during microphone acquisition releases the late stream", async () => {
  let active = true;
  const fresh = stream();
  const result = await acquireLiveMicrophone(null, async () => { active = false; return fresh.media; }, () => active);
  assert.equal(result, null);
  assert.equal(fresh.track.readyState, "ended");
});

test("paused sessions never request microphone access", async () => {
  assert.equal(await acquireLiveMicrophone(null, async () => { throw new Error("unexpected capture"); }, () => false), null);
});
