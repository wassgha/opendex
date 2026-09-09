import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ResponseCoordinator } from '../src/main/agent/realtime/response-coordinator';
function setup() {
  let requests = 0;
  const c = new ResponseCoordinator(() => requests++);
  return { c, count: () => requests };
}
test('fast tool completion waits for the calling response to finish', () => {
  const { c, count } = setup();
  c.userText(); c.created('initial'); c.toolStarted('screen');
  c.toolFinished('screen'); assert.equal(count(), 1);
  c.done('initial'); assert.equal(count(), 2);
});
test('multiple tool outputs generate one answer after every tool finishes', () => {
  const { c, count } = setup();
  c.created('initial'); c.toolStarted('a'); c.toolStarted('b'); c.done('initial');
  c.toolFinished('a'); assert.equal(count(), 0);
  c.toolFinished('b'); assert.equal(count(), 1);
  c.toolFinished('b'); assert.equal(count(), 1);
});
test('superseded tool output does not interrupt a new spoken turn', () => {
  const { c, count } = setup();
  c.created('old'); c.toolStarted('screen');
  c.speechStarted(); c.done('old'); c.speechStopped();
  c.toolFinished('screen'); assert.equal(count(), 0);
  c.created('new'); c.done('new'); assert.equal(count(), 0);
});
test('late cancellation completion cannot race VAD response creation', () => {
  const { c, count } = setup();
  c.created('old'); c.speechStarted(); c.speechStopped();
  c.request(); c.done('old'); assert.equal(count(), 0);
  c.created('new'); c.done('new'); assert.equal(count(), 1);
});
test('duplicate and stale done events do not release a newer response', () => {
  const { c, count } = setup();
  c.created('new'); c.request(); c.done('old'); assert.equal(count(), 0);
  c.done('new'); assert.equal(count(), 1);
});
test('cancel and session close prevent delayed tool speech', () => {
  const { c, count } = setup();
  c.created('initial'); c.toolStarted('screen'); c.cancel();
  c.toolFinished('screen'); c.done('initial'); assert.equal(count(), 0);
  c.close(); c.userText(); c.request(); assert.equal(count(), 0);
});
test('a rejected response does not lock out the next user request', () => {
  const { c, count } = setup();
  c.userText(); c.failed(); c.userText(); assert.equal(count(), 2);
});

test('duplicate completion while a continuation starts cannot open another slot', () => {
  const { c, count } = setup();
  c.created('initial'); c.request(); c.done('initial');
  c.request(); c.done('initial'); assert.equal(count(), 1);
  c.created('continuation'); c.done('continuation'); assert.equal(count(), 2);
});

test('queued status reads live measurements when speech can start, not when the question arrived', () => {
  const spoken: Array<string | undefined> = [];
  const c = new ResponseCoordinator(text => spoken.push(text));
  let measured = '0 completed';
  c.created('speaking'); c.toolStarted('benchmark');
  c.reportProgress('benchmark', () => measured);
  measured = '2 completed';
  c.done('speaking');
  assert.deepEqual(spoken, ['2 completed']);
});
