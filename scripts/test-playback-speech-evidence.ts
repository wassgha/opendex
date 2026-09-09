import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PlaybackSpeechEvidence } from '../src/main/agent/realtime/playback-speech-evidence';
import { openaiRealtimeCodec } from '../src/main/agent/realtime/openai-codec';

function turn(scores: Array<number | undefined>, playback = true) {
  const evidence = new PlaybackSpeechEvidence();
  for (const score of scores) evidence.append(1536, score, playback); // 32ms
  evidence.begin('turn', { audio_start_ms: 0 });
  evidence.end('turn', { audio_end_ms: scores.length * 32 });
  return evidence;
}
test('fully observed non-speech during playback vetoes a finalized transcript', () => {
  assert.equal(turn([0.001, 0.005, 0.158, 0.01]).rejects('turn'), true);
  assert.deepEqual(openaiRealtimeCodec.serializeItemDelete?.('turn'), { type: 'conversation.item.delete', item_id: 'turn' });
});
test('isolated spikes and the observed three-frame burst cannot validate a playback turn', () => {
  for (const scores of [[0.01, 0.3, 0.02, 0.01], [0.01, 0.95, 0.02, 0.01],
    [0.01, 0.8, 0.86, 0.7, 0.01], [0.01, 0.251, 0.01, 0.01]]) {
    assert.equal(turn(scores).rejects('turn'), true);
  }
});
test('sustained moderate and quiet speech remains eligible', () => {
  assert.equal(turn([0.01, ...Array(5).fill(0.3), 0.01]).rejects('turn'), false);
  assert.equal(turn(Array(3).fill(0.3), false).rejects('turn'), false);
});
test('wake replay and incomplete evidence are not mistaken for measured silence', () => {
  assert.equal(turn([undefined, undefined, undefined, undefined], false).rejects('turn'), false);
});
test('short sounds and silence outside playback cannot authorize a turn either', () => {
  assert.equal(turn([0.01, 0.01]).rejects('turn'), true);
  assert.equal(turn([0.01, 0.01, 0.01, 0.01], false).rejects('turn'), true);
});
test('echo tail is guarded using the audio clock even after playback has stopped', () => {
  const e = new PlaybackSpeechEvidence();
  e.append(1536, 0.01, true);
  for (let i = 0; i < 10; i++) e.append(1536, i < 3 ? 0.9 : 0.01, false);
  e.begin('tail', { audio_start_ms: 32 }); e.end('tail', { audio_end_ms: 352 });
  assert.equal(e.rejects('tail'), true);
  assert.equal(e.assess('tail').sustainedMs, 96);
});
test('uses the utterance audio interval rather than delayed transcript arrival', () => {
  const e = turn([0.01, 0.01, 0.01, 0.01]);
  e.append(1536, 0.99, false); // later speech must not validate earlier noise
  assert.equal(e.rejects('turn'), true);
  assert.equal(e.rejects('other'), true);
  e.begin('next', { raw: { audio_start_ms: 128 } });
  e.end('next', { raw: { audio_end_ms: 160 } });
  assert.equal(e.rejects('next'), true);
});
test('missing timestamps, invalid scores and expired history cannot approve playback input', () => {
  const e = turn([NaN, 0.01, 0.01, 0.01]);
  assert.equal(e.rejects('turn'), true);
  e.begin('turn', {}); e.end('turn', {});
  assert.equal(e.rejects('turn'), true);
  const expired = turn([0.01, 0.01, 0.01, 0.01]);
  expired.append(48 * 61000, 0.01, false);
  assert.equal(expired.rejects('turn'), true);
});

test('prefix padding cannot taint sustained speech beyond the echo tail', () => {
  const e = new PlaybackSpeechEvidence();
  e.append(48 * 1000, 0.01, true);
  for (let i = 0; i < 100; i++) e.append(1536, i > 25 ? 0.7 : 0.01, false);
  e.begin('reply', { audio_start_ms: 1600 }); e.end('reply', { audio_end_ms: 4200 });
  const result = e.assess('reply');
  assert.equal(result.playback, true, 'padded beginning overlaps the tail');
  assert.equal(result.reject, false);
  assert.ok(result.cleanSustainedMs > 1600);
  e.begin('next', { audio_start_ms: 4100 });
  assert.deepEqual(e.assess('reply'), result, 'later VAD cannot erase pending evidence');
});
