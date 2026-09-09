import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { quitApp } from '../src/skills/open/quit-app';
test('quit succeeds only after the identified process exits', async () => {
 let polls=0, requests=0;
 const result=await quitApp('Safari',{appPath:name=>{assert.equal(name,'Safari');return '/Safari.app';},requestQuit:path=>{assert.equal(path,'/Safari.app');requests++;return 42;},appRunning:pid=>{assert.equal(pid,42);return ++polls<3;}},async()=>{});
 assert.equal(result.status,'quit');assert.equal(polls,3);assert.equal(requests,1);
});
test('a save prompt or unresponsive app cannot report success or trigger retries',async()=>{
 let requests=0;
 const result=await quitApp('Safari',{appPath:()=>'/Safari.app',requestQuit:()=>{requests++;return 42;},appRunning:()=>true},async()=>{});
 assert.equal(result.ok,false);assert.equal(result.status,'still_running');assert.equal(requests,1);
});
test('an already closed app is not launched and needs no process polling',async()=>{
 const result=await quitApp('Safari',{appPath:()=>'/Safari.app',requestQuit:()=>0,appRunning:()=>{throw Error('unexpected poll');}},async()=>{});
 assert.equal(result.status,'already_closed');
});
test('resolution or native rejection returns failure without claiming a quit',async()=>{
 const result=await quitApp('Unknown',{appPath:()=>{throw Error('not found');},requestQuit:()=>{throw Error('unexpected request');},appRunning:()=>true},async()=>{});
 assert.equal(result.ok,false);assert.equal(result.error,'not found');
 const denied=await quitApp('Dex',{appPath:()=>'/Dex.app',requestQuit:()=>{throw Error('cannot quit');},appRunning:()=>true},async()=>{});
 assert.equal(denied.ok,false);assert.equal(denied.error,'cannot quit');
});
