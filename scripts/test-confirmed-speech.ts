import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConfirmedSpeech } from '../src/main/agent/realtime/confirmed-speech';
import { ResponseCoordinator } from '../src/main/agent/realtime/response-coordinator';

test('noise and timeout leave valid work alone; next speech still works', async () => {
  const accepted: string[] = [], discarded: string[] = [];
  const speech = new ConfirmedSpeech(text => accepted.push(text), id => discarded.push(id!), 10);
  speech.speechStarted('empty'); speech.speechStopped('empty'); speech.transcript('empty', ' ');
  speech.speechStarted('timeout'); speech.speechStopped('timeout');
  await new Promise(resolve => setTimeout(resolve, 25));
  speech.transcript('timeout', 'too late');
  assert.deepEqual(accepted, []);
  assert.deepEqual(discarded, ['empty', 'timeout']);
  speech.speechStarted('valid'); speech.speechStopped('valid'); speech.transcript('valid', 'Research Chicago');
  speech.transcript('valid', 'duplicate');
  assert.deepEqual(accepted, ['Research Chicago']);
});
test('pending segments are retained in audio order and clear cancels timeout', async () => {
  const accepted: string[] = [];
  let discarded = 0;
  const speech = new ConfirmedSpeech(text => accepted.push(text), () => discarded++, 10);
  speech.speechStarted('old'); speech.speechStopped('old');
  speech.speechStarted('new'); speech.speechStopped('new'); speech.transcript('old', 'obsolete');
  assert.deepEqual(accepted, []);
  speech.transcript('new', 'continuation');
  assert.deepEqual(accepted, ['obsolete continuation']);
  speech.speechStarted('cleared'); speech.speechStopped('cleared');
  speech.clear(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(discarded, 0);
});
test('confirmed interruption waits for cancelled response completion before requesting next', () => {
  let requests = 0;
  const c = new ResponseCoordinator(() => requests++);
  c.userText(); c.created('old'); c.speechStarted(); c.speechStopped(false);
  assert.equal(requests, 1);
  c.done('old'); assert.equal(requests, 2);
  c.created('new'); c.done('old'); assert.equal(requests, 2);
});

test('out-of-order wake transcriptions produce one complete request without losing earlier clauses', () => {
  const accepted: string[] = [];
  const speech = new ConfirmedSpeech(text => accepted.push(text), () => {});
  for (const id of ['a', 'b', 'c']) { speech.speechStarted(id); speech.speechStopped(id); }
  speech.transcript('c', 'and score the result');
  speech.transcript('a', 'Build a browser benchmark');
  assert.deepEqual(accepted, []);
  speech.transcript('b', 'with repeatable tasks');
  assert.deepEqual(accepted, ['Build a browser benchmark with repeatable tasks and score the result']);
  speech.transcript('b', 'duplicate');
  assert.equal(accepted.length, 1);
  speech.clear();
});
