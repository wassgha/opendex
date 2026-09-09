import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WakeAudioBuffer, replayWakeAudio, realtimeWakeInput } from '../src/renderer/src/lib/dex/engines/wake-audio';
test('real audio survives ring wrap with the original utterance boundaries', () => {
 const b=new WakeAudioBuffer(2);
 b.push(new Int16Array(16000).fill(11));
 b.push(new Int16Array(16000).fill(22));
 b.push(new Int16Array(16000).fill(33));
 const a=b.utterance(1.2,2.5)!;
 assert.equal(a.pcm[0],22); assert.equal(a.pcm.at(-1),33);
 assert.equal(a.pcm.length,25600);
 assert.equal(b.utterance(0,0.5),undefined);
});
test('stop clears retained audio and rejects malformed boundaries', () => {
 const b=new WakeAudioBuffer();b.push(new Int16Array(32000).fill(123));b.clear();
 assert.equal(b.utterance(0,1),undefined);
 assert.equal(b.utterance(NaN,1),undefined);
});
test('replay is 24 kHz PCM with enough trailing silence for server VAD', () => {
 const r=replayWakeAudio({pcm:new Int16Array(16000).fill(500),sampleRate:16000});
 assert.equal(r.length,43200); assert.equal(r[23999],500);
 assert.ok(r.subarray(24000).every(s=>s===0));
});
test('misrecognized forty c cannot become the realtime command', () => {
 const audio={pcm:new Int16Array([1,2]), sampleRate:16000 as const};
 assert.deepEqual(realtimeWakeInput('vosk','forty c',audio),{initialAudio:audio});
 assert.deepEqual(realtimeWakeInput('vosk','forty c'),{initialAudio:undefined});
 assert.deepEqual(realtimeWakeInput('webspeech','what do you see'),{initialText:'what do you see'});
});
