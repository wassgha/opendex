import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Model } from "vosk-browser";
import { InputPreview } from "../src/renderer/src/lib/dex/realtime/input-preview";

function fixture() {
  const recognizers: FakeRecognizer[] = [];
  class FakeRecognizer {
    listeners = new Map<string, (message: any) => void>();
    removed = false;
    fail = false;
    constructor(public rate: number) { recognizers.push(this); }
    on(event: string, listener: (message: any) => void) { this.listeners.set(event, listener); }
    emit(event: string, result: object) { this.listeners.get(event)?.({ result }); }
    acceptWaveformFloat(frame: Float32Array, rate: number) {
      assert.equal(rate, 16000);
      if (this.fail) throw new Error("Worker unavailable");
      structuredClone(frame, { transfer: [frame.buffer] });
    }
    remove() { this.removed = true; }
  }
  const model = { KaldiRecognizer: FakeRecognizer } as unknown as Model;
  const texts: string[] = [];
  return { model, recognizers, texts };
}

test("partial words appear before completion, preserve the mic buffer, and reset rejects stale results", async () => {
  const f = fixture();
  const preview = new InputPreview(text => f.texts.push(text), async () => f.model);
  await preview.start();
  const rec = f.recognizers[0];
  const frame = new Float32Array([0.1, 0.2]);
  preview.feed(frame);
  assert.equal(frame.length, 2, "preview cannot detach the frame used for voice capture");
  rec.emit("partialresult", { partial: "open" });
  rec.emit("partialresult", { partial: "open" });
  rec.emit("result", { text: "open the" });
  rec.emit("partialresult", { partial: "window" });
  assert.deepEqual(f.texts, ["open", "open the", "open the window"]);
  preview.reset();
  rec.emit("partialresult", { partial: "stale input" });
  assert.equal(f.texts.at(-1), "");
  assert.equal(rec.removed, true);
  preview.close();
  f.recognizers[1].emit("result", { text: "late after close" });
  assert.equal(f.texts.at(-1), "");
});

test("closing during model loading never creates a late recognizer", async () => {
  const f = fixture();
  let resolve!: (model: Model) => void;
  const preview = new InputPreview(text => f.texts.push(text), () => new Promise(r => { resolve = r; }));
  const starting = preview.start();
  preview.close();
  resolve(f.model);
  await starting;
  assert.equal(f.recognizers.length, 0);
});

test("preview failures cannot throw into microphone forwarding", async () => {
  const f = fixture();
  const preview = new InputPreview(text => f.texts.push(text), async () => f.model);
  await preview.start();
  f.recognizers[0].emit("partialresult", { partial: "tentative" });
  f.recognizers[0].fail = true;
  assert.doesNotThrow(() => preview.feed(new Float32Array(512)));
  assert.equal(f.recognizers[0].removed, true);
  assert.equal(f.texts.at(-1), "");
});
