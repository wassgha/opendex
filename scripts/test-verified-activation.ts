import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { verifyActivation } from '../src/skills/open/verified-activation';
test('waits for visible window rather than reporting launch as success', async () => {
 let polls = 0;
 await verifyActivation('/app', { activateApp:()=>12, appVisible: pid => { assert.equal(pid,12); return ++polls === 4; } }, async()=>{});
 assert.equal(polls,4);
});
test('an app active in another Space never receives a success report', async () => {
 let activations=0;
 await assert.rejects(verifyActivation('/app', { activateApp:()=>++activations, appVisible:()=>false }, async()=>{}), /not visible/);
 assert.equal(activations,2);
});
test('native activation failures propagate without a success', async () => {
 await assert.rejects(verifyActivation('/missing', { activateApp:()=>{throw new Error('not running');}, appVisible:()=>true }, async()=>{}), /not running/);
});
