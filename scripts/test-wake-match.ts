import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matchesWakeResult, wakeCommandFromResult } from "../src/renderer/src/lib/dex/engines/wake-match";

const word = (word: string, conf = 0.95) => ({ word, conf, start: 0.2, end: 0.6 });

test("the request spoken after Dex survives the wake handoff", () => {
  assert.equal(wakeCommandFromResult("hey decks minimize the current window".split(" ").map((w) => word(w)), "dex"), "minimize the current window");
  assert.equal(wakeCommandFromResult([word("dex")], "dex"), "");
  assert.equal(wakeCommandFromResult([word("desk"), word("minimize")], "dex"), null);
  assert.equal(wakeCommandFromResult("hello computer open settings".split(" ").map((w) => word(w)), "hello computer"), "open settings");
});

test("accept the observed live Dex score but reject names inside background speech", () => {
  assert.equal(wakeCommandFromResult([word("dex", 0.62907), word("what"), word("time")], "dex"), "what time");
  assert.equal(wakeCommandFromResult([word("dax", 1), word("what"), word("time")], "dex"), "what time");
  assert.equal(wakeCommandFromResult([word("dax", 1), word("what")], "computer"), null);
  assert.equal(wakeCommandFromResult([word("dex", 0.493368)], "dex"), "");
  assert.equal(wakeCommandFromResult("i was talking about dex yesterday".split(" ").map((w) => word(w)), "dex"), null);
});

test("Dex accepts its common spoken homophone and words in a request", () => {
  assert.equal(matchesWakeResult([word("dex")], "Dex"), true);
  assert.equal(matchesWakeResult([word("hey"), word("decks"), word("look")], "Dex"), true);
});

test("unconfirmed, malformed, and unrelated recognition cannot wake Dex", () => {
  for (const result of [undefined, [], [word("dex", NaN)], [word("desk")], [word("index")], [word("[unk]")]]) {
    assert.equal(matchesWakeResult(result, "dex"), false);
  }
  assert.equal(matchesWakeResult([{ ...word("dex"), end: 0.2 }], "dex"), false);
});

test("custom wake phrases require adjacent completed words and literal matching", () => {
  assert.equal(matchesWakeResult([word("hello"), word("computer")], "Hello computer"), true);
  assert.equal(matchesWakeResult([word("hello"), word("there"), word("computer")], "hello computer"), false);
  assert.equal(matchesWakeResult([word("hello"), word("computer", 0.4)], "hello computer"), true);
  assert.equal(matchesWakeResult([word("dex")], "d.x"), false);
});
