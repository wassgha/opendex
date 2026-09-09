import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { configureEchoCancellation } from '../src/renderer/src/lib/dex/realtime/echo-cancellation';
test('requests cancellation of local speaker playback when supported', async () => {
 let constraint: unknown;
 const track = { getCapabilities:()=>({echoCancellation:[true,false,'all','remote-only']}),applyConstraints:async(c:unknown)=>{constraint=c},getSettings:()=>({echoCancellation:'all'}) };
 const result=await configureEchoCancellation(track as unknown as MediaStreamTrack);
 assert.deepEqual(constraint,{echoCancellation:{exact:'all'}}); assert.equal(result.actual,'all');
});
test('older browsers retain echo cancellation without disabling capture', async () => {
 let constraint:unknown;
 const track={getCapabilities:()=>({echoCancellation:[true,false]}),applyConstraints:async(c:unknown)=>{constraint=c},getSettings:()=>({echoCancellation:true})};
 assert.equal((await configureEchoCancellation(track as unknown as MediaStreamTrack)).actual,true);
 assert.deepEqual(constraint,{echoCancellation:true});
});
test('a rejected all mode falls back to the supported boolean setting', async () => {
 let calls=0;
 const track={getCapabilities:()=>({echoCancellation:['all']}),applyConstraints:async()=>{if(++calls===1)throw new Error('unsupported')},getSettings:()=>({echoCancellation:true})};
 const result=await configureEchoCancellation(track as unknown as MediaStreamTrack);
 assert.equal(calls,2);assert.equal(result.requested,true);assert.equal(result.fallback,'Error');
});
