import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { screenIssueForError, screenBillingUrl, SCREEN_RECOVERY } from '../src/main/config/screen-health';
import { isSleepCommand } from '../src/renderer/src/lib/dex/sleep-command';
import { awarenessLabel } from '../src/renderer/src/lib/dex/state';

test('billing exhaustion differs from a temporary rate limit and never exposes error payloads', () => {
  const quota = {statusCode:429,responseBody:JSON.stringify({error:{code:'credit_balance_exhausted',message:'private-key'}})};
  assert.equal(screenIssueForError(quota),'quota');
  assert.equal(screenIssueForError({statusCode:429}),'rate_limit');
  assert.equal(screenIssueForError({statusCode:401}),'authentication');
  assert.equal(screenIssueForError({message:'no OpenAI API key is set'}),'authentication');
  assert.equal(screenIssueForError({name:'TimeoutError'}),'connection');
  assert.equal(screenIssueForError({statusCode:404}),'unsupported');
  assert.equal(screenIssueForError(null),'unknown');
  assert.doesNotMatch(JSON.stringify(SCREEN_RECOVERY),/private-key/);
  assert.equal(screenBillingUrl('openai'),'https://platform.openai.com/settings/organization/billing/overview');
  assert.equal(screenBillingUrl('gateway'),null);
});

test('sleep commands accept the wake name but do not match questions or quotations', () => {
  for (const s of ['go to sleep','Dex, go to sleep.','please go to sleep','go to sleep please','Sleep!']) assert.equal(isSleepCommand(s),true,s);
  for (const s of ['what does go to sleep mean','do not go to sleep','say go to sleep','"go to sleep"','go to sleep in 10 minutes']) assert.equal(isSleepCommand(s),false,s);
  assert.equal(isSleepCommand('computer, go to sleep','computer'),true);
});

test('awake, asleep and microphone-off states have different explicit labels', () => {
  assert.equal(awarenessLabel('listening_wake','Dex'),'Asleep · say Dex');
  assert.equal(awarenessLabel('active_listening'),'Awake · listening to you');
  assert.equal(awarenessLabel('follow_up_listening'),'Awake · listening to you');
  assert.equal(awarenessLabel('muted'),'Paused · microphone off');
});

test('sleep requests are not replayed when a new voice session wakes', async () => {
  const { reconnectHistory, allowModelSleep } = await import('../src/main/config/voice-commands');
  const history = reconnectHistory([
    {role:'user',content:'What is on my screen?'},
    {role:'assistant',content:'A browser window.'},
    {role:'user',content:'Dex, go to sleep.'},
  ], 'Dex');
  assert.match(history,/A browser window/);
  assert.doesNotMatch(history,/user: Dex, go to sleep/);
  assert.match(history,/Wait for a new live request/);
  assert.equal(allowModelSleep(true,false),false);
  assert.equal(allowModelSleep(true,true),false);
  assert.equal(allowModelSleep(false,false),false);
  assert.equal(allowModelSleep(false,true),true);
});
