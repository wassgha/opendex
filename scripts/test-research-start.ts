import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { withResearchStart, researchSearchUrl } from '../src/main/agent/research-start';
import { researchStepLimit } from '../src/main/agent/research-budget';
const plan = { topic:'Chicago heat pumps',steps:['Read climate sources','Compare costs'],update:'Checking climate and costs',openQuestions:[] };
const firstPage = {query:'Chicago heat pumps',browser:'Safari'};
function setup(allowed=true, abort?: AbortController) {
 const events:string[]=[];
 const tools = {
  updateResearch:tool({inputSchema:z.any(),execute:async input=>{events.push('plan');return input;}}),
  openUrl:tool({inputSchema:z.any(),execute:async input=>{events.push('permission');assert.deepEqual(input,{url:'https://www.google.com/search?q=Chicago+heat+pumps',browser:'Safari'}); if(!allowed)return {error:'Permission denied'}; events.push('open');return {opened:true};}}),
 };
 const combined=withResearchStart(tools,{onToolCall:c=>events.push('call:'+c.toolName),onToolResult:r=>{events.push('result:'+r.toolName); if(r.toolName==='updateResearch')abort?.abort();}})!;
 return {tools,events,run:()=>combined.startResearch.execute!({plan,firstPage},{toolCallId:'start',messages:[],abortSignal:abort?.signal})};
}
test('one startup execution shows the plan then uses the existing URL permission wrapper',async()=>{
 const s=setup(); await s.run();
 assert.deepEqual(s.events,['call:updateResearch','plan','result:updateResearch','call:openUrl','permission','open','result:openUrl']);
 assert.equal(researchStepLimit([{toolCalls:[{toolName:'startResearch'}]}]),96);
});
test('denial does not open the URL or retry',async()=>{
 const s=setup(false); const result=await s.run() as any;
 assert.equal(result.navigation.error,'Permission denied'); assert.equal(s.events.includes('open'),false);
 assert.equal(s.events.filter(e=>e==='permission').length,1);
});
test('cancellation after displaying the plan prevents navigation',async()=>{
 const s=setup(true,new AbortController()); await assert.rejects(async()=>s.run());
 assert.equal(s.events.includes('permission'),false);
});
test('startup is unavailable if either underlying tool is unavailable',()=>{
 const {tools}=setup(); const onlyPlan={updateResearch:tools.updateResearch};
 assert.equal(withResearchStart(onlyPlan,{}),onlyPlan);
 assert.equal(withResearchStart(undefined,{}),undefined);
});

test('search URLs encode the query and preserve the requested engine',()=>{const u=new URL(researchSearchUrl('Chicago & heat pumps #cost','bing'));assert.equal(u.origin,'https://www.bing.com');assert.equal(u.searchParams.get('q'),'Chicago & heat pumps #cost');assert.equal(u.hash,'');});
