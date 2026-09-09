import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isNewSessionCommand, reconnectHistory } from '../src/main/config/voice-commands';

test('new-session command accepts explicit variants and custom wake words', () => {
  for (const input of ['start a new session', 'Start new session.', 'Dex, start a new session please', 'new session', 'Okay, new session.', 'OK, Dex, start a new session', 'All right, new session', 'Please begin a new session now']) assert.equal(isNewSessionCommand(input), true, input);
  assert.equal(isNewSessionCommand('Computer, start a new session', 'computer'), true);
  for (const input of ['do not start a new session', 'how do I start a new session?', '"start a new session"', 'start a new session tomorrow', 'start a new session and delete files', 'restart the app']) assert.equal(isNewSessionCommand(input), false, input);
});
test('new session keeps ordinary context but never replays session-control requests', () => {
  const history = reconnectHistory([
    { role: 'user', content: 'Find my Codex tasks' },
    { role: 'user', content: 'Dex, start a new session' },
    { role: 'user', content: 'go to sleep' },
  ], 'dex');
  assert.match(history, /Find my Codex tasks/);
  assert.doesNotMatch(history, /user: Dex, start a new session|user: go to sleep/);
});
