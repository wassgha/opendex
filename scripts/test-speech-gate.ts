import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SpeechGate, pcm24k } from '../src/renderer/src/lib/dex/realtime/speech-gate';
const frame=()=>new Float32Array(512).fill(0.5);
test('loud non-speech and short speech-like transients do not reach the service',()=>{
 const gate=new SpeechGate();
 for(const probability of [0.1,0.2,0.9,0.9,0.1,0.8,0.2])assert.ok(gate.process(probability,frame()).every(f=>f.every(v=>v===0)));
});
test('confirmed speech preserves the onset and streams without waiting for utterance end',()=>{
 const events:boolean[]=[];const gate=new SpeechGate(open=>events.push(open));
 for(let i=0;i<4;i++)gate.process(0.95,frame());
 const out=gate.process(0.95,frame());assert.equal(out.length,5);assert.equal(out[0][0],0.5);
 assert.equal(gate.process(0.95,frame())[0][0],0.5);assert.deepEqual(events,[true]);
});
test('noise after speech closes the gate; a later utterance can interrupt again',()=>{
 const gate=new SpeechGate();for(let i=0;i<5;i++)gate.process(0.9,frame());
 for(let i=0;i<25;i++)gate.process(0.1,frame());
 assert.equal(gate.process(0.1,frame())[0][0],0);
 for(let i=0;i<4;i++)gate.process(0.9,frame());
 assert.ok(gate.process(0.9,frame()).some(f=>f[0]===0.5));
 gate.clear();assert.equal(gate.process(0.9,frame())[0][0],0);
});
test('accepted frames retain duration and safe PCM levels at 24 kHz',()=>{
 const output=new Int16Array(pcm24k(frame()));assert.equal(output.length,768);assert.equal(output[0],16383);
});

test('quieter continuation and a half-second pause preserve the steering sentence',()=>{
 const events:boolean[]=[];const gate=new SpeechGate(open=>events.push(open));
 for(let i=0;i<5;i++)gate.process(0.9,frame());
 for(let i=0;i<40;i++)assert.equal(gate.process(0.25,frame())[0][0],0.5);
 for(let i=0;i<16;i++)assert.equal(gate.process(0.05,frame())[0][0],0.5);
 assert.equal(gate.process(0.4,frame())[0][0],0.5);
 assert.deepEqual(events,[true]);
 for(let i=0;i<25;i++)gate.process(0.05,frame());
 assert.deepEqual(events,[true,false]);
 for(let i=0;i<30;i++)assert.equal(gate.process(0.25,frame())[0][0],0);
});


test('moderate follow-up speech after playback is accepted with its onset intact',()=>{
 const gate=new SpeechGate();
 for(let i=0;i<10;i++)gate.process(0.05,frame(),true);
 assert.equal(gate.process(0.57,frame(),false)[0][0],0);
 assert.equal(gate.process(0.61,frame(),false)[0][0],0);
 assert.ok(gate.process(0.55,frame(),false).some(f=>f[0]===0.5));
});
test('listening still rejects loud noise and isolated speech-like transients',()=>{
 const gate=new SpeechGate();
 for(const p of [0.1,0.9,0.9,0.1,0.8,0.2,0.49,0.49,0.49])
  assert.ok(gate.process(p,frame(),false).every(f=>f.every(v=>v===0)));
});
test('playback retains stricter onset and cannot inherit partial listening confirmation',()=>{
 const gate=new SpeechGate();
 gate.process(0.9,frame(),false);gate.process(0.9,frame(),false);
 for(let i=0;i<12;i++)assert.equal(gate.process(0.6,frame(),true)[0][0],0);
 for(let i=0;i<4;i++)assert.equal(gate.process(0.9,frame(),true)[0][0],0);
 assert.ok(gate.process(0.9,frame(),true).some(f=>f[0]===0.5));
});
