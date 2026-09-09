import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream, tool } from 'ai';
import { z } from 'zod';
import { isEmailOverview } from '../src/main/agent/email-overview';
import { streamChat } from '../src/main/agent/chat';
import { isDesktopStatusQuestion, desktopProgress } from '../src/main/agent/realtime/desktop-status';

test('status intent is narrow and does not swallow steering or cancellation', () => {
 for(const text of ['What are you doing?','Dex, what are you doing?','Are you still working?','Any update?', "Dex, what's going on?", "No, I'm asking what's going on.", 'Dex was wrong.', "What's wrong?"]) assert.equal(isDesktopStatusQuestion(text),true,text);
 for(const text of ['Stop','What are you doing? Stop it.','What are you doing with my email? Delete it.','Check my email',"What's going on? Cancel it.",'Dex was wrong. Use Safari instead.']) assert.equal(isDesktopStatusQuestion(text),false,text);
 assert.match(desktopProgress('captureScreen'), /screen image/);
 assert.match(desktopProgress('click',true), /problem/);
});
test('overview selection leaves explicit message reads and combined mutations to normal routing', () => {
 for(const text of ['Check my email','Check the user’s Gmail inbox using the existing browser. Do not open messages.']) assert.equal(isEmailOverview([{role:'user',content:text}]),true);
 for(const text of ['Read the second email','Check my email and reply to Sam','Explain this code']) assert.equal(isEmailOverview([{role:'user',content:text}]),false);
});
test('overview never exposes click/type tools and uses low GPT-5 reasoning', async () => {
 const make = () => tool({inputSchema:z.object({}), execute:async()=>({ok:true})});
 const model = new MockLanguageModelV3({provider:'openai.responses',modelId:'gpt-5',doStream:async options => {
  assert.deepEqual(options.tools?.map(t=>t.name).sort(),['captureScreen','openUrl','scroll','zoomScreen']);
  assert.equal(options.providerOptions?.openai?.reasoningEffort,'low');
  return {stream:simulateReadableStream({initialDelayInMs:null,chunkDelayInMs:null,chunks:[
   {type:'stream-start',warnings:[]}, {type:'text-start',id:'t'}, {type:'text-delta',id:'t',delta:'No inbox inspected in this fixture.'},{type:'text-end',id:'t'},
   {type:'finish',finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}},
  ]})};
 }});
 await streamChat({model,system:'Fixture',messages:[{role:'user',content:'Check my email'}],tools:{captureScreen:make(),openUrl:make(),scroll:make(),zoomScreen:make(),click:make(),typeText:make()},onDelta:()=>{}});
});

test('overview stops gathering after five tool steps and requests a final report', async () => {
 let calls=0;
 const model=new MockLanguageModelV3({doStream:async options=>{
  const finish=calls++===5;
  if(finish) assert.deepEqual(options.toolChoice,{type:'none'});
  return {stream:simulateReadableStream({initialDelayInMs:null,chunkDelayInMs:null,chunks:[
   {type:'stream-start',warnings:[]},
   ...(finish ? [{type:'text-start',id:'t'},{type:'text-delta',id:'t',delta:'The fixture inbox could not be read.'},{type:'text-end',id:'t'}] : [{type:'tool-call',toolCallId:`capture-${calls}`,toolName:'captureScreen',input:'{}'}]),
   {type:'finish',finishReason:{unified:finish?'stop':'tool-calls',raw:finish?'stop':'tool_calls'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}}},
  ] as never})};
 }});
 await streamChat({model,system:'Fixture',messages:[{role:'user',content:'Check my email'}],tools:{captureScreen:tool({inputSchema:z.object({}),execute:async()=>({ok:true})})},onDelta:()=>{}});
 assert.equal(calls,6);
});
