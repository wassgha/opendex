import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EchoReferenceOutput } from '../src/renderer/src/lib/dex/realtime/echo-reference-output';
function setup(fail = false) {
 const peers: any[]=[]; let stopped=0, paused=0;
 class Peer {
  localDescription:any;remoteDescription:any;connectionState='new';onconnectionstatechange?:()=>void;ontrack:any;onicecandidate:any;closed=false;
  constructor(public config:any){peers.push(this)}
  addTrack(){} async createOffer(){if(fail)throw new Error('negotiation');return{type:'offer'}}
  async createAnswer(){return{type:'answer'}}
  async setLocalDescription(s:any){this.localDescription=s;if(s.type==='answer'){this.connectionState='connected';this.onconnectionstatechange?.()}}
  async setRemoteDescription(s:any){this.remoteDescription=s}async addIceCandidate(){}close(){this.closed=true}
 }
 class Audio { autoplay=false;srcObject:any;async play(){}pause(){paused++} }
 const track={stop:()=>stopped++}; const input={stream:{getTracks:()=>[track]},disconnect(){}};
 const ctx={createMediaStreamDestination:()=>input};
 return {Peer, Audio, ctx, peers, stopped:()=>stopped, paused:()=>paused};
}
test('echo reference negotiates locally and releases every resource', async t => {
 const s=setup();t.mock.method(globalThis as any,'setTimeout',setTimeout);
 const oldPeer=(globalThis as any).RTCPeerConnection, oldAudio=(globalThis as any).Audio;
 Object.assign(globalThis,{RTCPeerConnection:s.Peer,Audio:s.Audio});
 try {
  const output=await EchoReferenceOutput.create(s.ctx as unknown as AudioContext,()=>{});
  assert.equal(s.peers.length,2);assert.ok(s.peers.every(p=>p.config.iceServers.length===0));
  output.pause();output.dispose();assert.ok(s.peers.every(p=>p.closed));assert.equal(s.stopped(),1);assert.ok(s.paused()>=2);
 } finally {Object.assign(globalThis,{RTCPeerConnection:oldPeer,Audio:oldAudio})}
});
test('negotiation failure closes peers and generated audio track', async () => {
 const s=setup(true);const oldPeer=(globalThis as any).RTCPeerConnection,oldAudio=(globalThis as any).Audio;
 Object.assign(globalThis,{RTCPeerConnection:s.Peer,Audio:s.Audio});
 try {await assert.rejects(EchoReferenceOutput.create(s.ctx as unknown as AudioContext,()=>{}));assert.ok(s.peers.every(p=>p.closed));assert.equal(s.stopped(),1)}
 finally {Object.assign(globalThis,{RTCPeerConnection:oldPeer,Audio:oldAudio})}
});
