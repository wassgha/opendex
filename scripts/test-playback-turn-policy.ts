import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDirectedPlaybackTurn } from '../src/main/agent/realtime/playback-turn-policy';
import { PlaybackSpeechEvidence } from '../src/main/agent/realtime/playback-speech-evidence';

test('incident-length speech confidence cannot authorize an unaddressed playback turn', () => {
 const e = new PlaybackSpeechEvidence();
 for(let i=0;i<9;i++) e.append(1536,0.99,true);
 e.begin('fixture',{audio_start_ms:0});e.end('fixture',{audio_end_ms:288});
 assert.equal(e.assess('fixture').reject,false);
 for(const text of ['left.','I will pull up Gmail','Check my email.','yeah']) assert.equal(isDirectedPlaybackTurn(text,'Dex'),false);
});
test('addressed steering and explicit short emergency controls remain usable', () => {
 for(const text of ['Dex, check Gmail','Hey Dex, wait','stop','Stop talking!','cancel that','go to sleep','please stop','Wait, change that']) assert.equal(isDirectedPlaybackTurn(text,'Dex'),true);
 assert.equal(isDirectedPlaybackTurn('index','Dex'),false);
 assert.equal(isDirectedPlaybackTurn('Nova, use the other tab','Nova'),true);
 assert.equal(isDirectedPlaybackTurn('Dex, use the other tab','Nova'),false);
 assert.equal(isDirectedPlaybackTurn('anything',''),false);
});
