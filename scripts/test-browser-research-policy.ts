import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { isBrowserResearch, isSearchEntry, withBrowserResearchPolicy } from '../src/main/agent/browser-research-policy';
import { BenchmarkHost } from '../src/main/benchmarks/host';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const options={toolCallId:'test',messages:[]};
function setup(active=true){
 const calls:string[]=[];
 const original=Object.fromEntries(['openUrl','updateResearch','click','typeText','pressKeys','webSearch'].map(name=>[name,tool({inputSchema:z.any(),execute:async()=>{calls.push(name);return {ok:true};}})]));
 const tools=withBrowserResearchPolicy(original,active)!;
 return {calls,run:(name:string,input:unknown)=>tools[name].execute!(input,options)};
}
test('only direct search entry points are permitted',()=>{
 assert.equal(isSearchEntry('https://www.google.com/search?q=heat+pumps'),true);
 for(const url of ['https://www.energy.gov/page','https://www.google.com/url?q=https://evil.test','https://www.google.com/search?q=a&url=https://evil.test','https://www.google.com.evil.test/search?q=a','https://user@www.google.com/search?q=a'])assert.equal(isSearchEntry(url),false);
});
test('source URL, clipboard, and API shortcuts are blocked before execution',async()=>{
 const s=setup();
 for(const [name,input] of [['openUrl',{url:'https://example.org/source'}],['typeText',{text:'https://example.org/source'}],['pressKeys',{keys:['Cmd','V']}],['pressKeys',{keys:['Cmd','C']}],['webSearch',{query:'heat pumps'}]] as const){assert.ok((await s.run(name,input) as any).error);}
 assert.deepEqual(s.calls,[]);
 await s.run('click',{x:100,y:200}); await s.run('typeText',{text:'Chicago heat pump performance'}); await s.run('openUrl',{url:'https://www.bing.com/search?q=heat+pumps'});
 assert.deepEqual(s.calls,['click','typeText','openUrl']);
});
test('ordinary navigation is retained; research progress activates the rule',async()=>{
 const s=setup(false);await s.run('openUrl',{url:'https://example.org'});await s.run('updateResearch',{});await s.run('openUrl',{url:'https://example.org/source'});
 assert.deepEqual(s.calls,['openUrl','updateResearch']);
});
test('baseline comparison reproduces research classification but only the exact live fixture passes the original gate', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'dex-fixture-policy-'));
 const host = new BenchmarkHost(dir);
 try {
  const started = await host.start('policy test') as {url:string};
  assert.equal(isBrowserResearch([{role:'user',content:'Run the browser benchmark and report any baseline comparison.'}]),true);
  let grants=0;
  const original={openUrl:tool({inputSchema:z.any(),execute:async()=>{grants++;return {error:'Permission denied by the user.'};}})};
  const blocked=withBrowserResearchPolicy(original,true)!;
  assert.match(String((await blocked.openUrl.execute!({url:started.url},options) as any).error),/Browser research/);
  assert.equal(grants,0);
  const tools=withBrowserResearchPolicy(original,true,url=>host.ownsUrl(url))!;
  assert.match(String((await tools.openUrl.execute!({url:started.url},options) as any).error),/Permission denied/);
  assert.equal(grants,1);
  for(const url of [started.url+'/click',started.url+'?redirect=x',started.url.replace('127.0.0.1','localhost'),'http://127.0.0.1:1234/','https://example.org']) await tools.openUrl.execute!({url},options);
  assert.equal(grants,1);
  await host.stop(); await tools.openUrl.execute!({url:started.url},options); assert.equal(grants,1);
 } finally {await host.stop(); await rm(dir,{recursive:true,force:true});}
});
