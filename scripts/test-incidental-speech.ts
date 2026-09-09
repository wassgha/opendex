import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isIncidentalSpeech } from '../src/main/agent/realtime/incidental-speech';
test('isolated non-command vocalizations do not interrupt active work',()=>{
 for(const text of ['Hmm','hmm.','Um','uh...','erm'])assert.equal(isIncidentalSpeech(text,true),true);
});
test('real commands, corrections and idle speech are retained',()=>{
 for(const text of ['stop','no','yes','wait','go to sleep','hmm no, use Safari','um stop','Dex'])assert.equal(isIncidentalSpeech(text,true),false);
 assert.equal(isIncidentalSpeech('Hmm',false),false);
});

import { isPlaybackAcknowledgment } from '../src/main/agent/realtime/incidental-speech';
test('brief acknowledgments preserve declarative playback, including after generation completes', () => {
  for (const text of ['Yeah', 'Okay.', 'yes', 'mhm', 'uh-huh']) {
    assert.equal(isPlaybackAcknowledgment(text, true, 'One task is active. The other is idle.'), true);
    assert.equal(isPlaybackAcknowledgment(text, false, 'One task is active.'), false);
  }
});
test('questions, unknown output, corrections and commands still accept speech', () => {
  for (const question of ['Should I open it?', 'Would you like me to continue', 'Please confirm the selected folder.', 'Tell me when you are ready']) {
    assert.equal(isPlaybackAcknowledgment('Yeah', true, question), false);
  }
  assert.equal(isPlaybackAcknowledgment('Yeah', true, ''), false);
  for (const text of ['Stop', 'No', 'Wait', 'Yeah but read the other task', 'Go ahead', 'Cancel', 'Actually that is wrong']) {
    assert.equal(isPlaybackAcknowledgment(text, true, 'One task is active.'), false);
  }
});
