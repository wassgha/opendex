import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MicPcmFeed } from '../src/renderer/src/lib/dex/realtime/pcm-capture';

test('low-confidence double-talk reaches the server once and in order, then stops on teardown', async () => {
 const previous = (globalThis as any).document;
 (globalThis as any).document = { baseURI: 'https://example.invalid/' };
 let options: any, destroyed = 0, playing = true;
 const chunks: Int16Array[] = [];
 const scores: Array<number | undefined> = [];
 try {
  const feed = await MicPcmFeed.create({state:'running'} as AudioContext,
   {getAudioTracks:()=>[{readyState:'live',muted:false}]} as unknown as MediaStream,
   (chunk, score)=>{chunks.push(new Int16Array(chunk)); scores.push(score);}, ()=>{}, ()=>{}, ()=>playing,
   async value=>{options=value;return {start:async()=>{},destroy:async()=>{destroyed++;}} as any;});
  try {
   // These represent speech missed by the old local gate during playback.
   const probabilities = [0.127, 0.333, 0.038, 0.9, 0.95, 0.98, 0.8, 0.9];
   probabilities.forEach((isSpeech,index)=>{
    if(index===2)playing=false;
    options.onFrameProcessed({isSpeech},new Float32Array(512).fill((index+1)/10));
   });
   assert.equal(chunks.length,probabilities.length);
   assert.deepEqual(scores, probabilities);
   chunks.forEach((chunk,index)=>{
    assert.equal(chunk.length,768);
    assert.ok(Math.abs(chunk[0]-Math.trunc(((index+1)/10)*32767))<=1);
   });
   feed.stop();
   options.onFrameProcessed({isSpeech:0.99},new Float32Array(512).fill(0.8));
   assert.equal(chunks.length,probabilities.length);
   assert.equal(destroyed,1);
  } finally { feed.stop(); }
 } finally { if(previous===undefined)delete (globalThis as any).document;else (globalThis as any).document=previous; }
});
