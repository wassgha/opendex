// Local read-only latency probe. Tool definitions are supplied without execute.
const { app } = require('electron');
const { join } = require('node:path');
const { homedir } = require('node:os');
require('tsx/cjs');
app.setName('opendex');
app.setPath('userData', join(homedir(), 'Library/Application Support/opendex'));
app.whenReady().then(async () => {
 try {
  const { initConfig, getConfig } = require('../src/main/config/store.ts');
  initConfig();
  const cfg = getConfig();
  const { resolveModel } = require('../src/main/agent/llm/resolve-model.ts');
  const { buildSystemPrompt } = require('../src/main/agent/system-prompt.ts');
  const { buildToolSet, skillSystemPrompts } = require('../src/skills/registry.ts');
  const { streamText } = require('ai');
  const definitions = buildToolSet({ config: cfg, requestPermission: async () => false });
  const toolDefs = Object.fromEntries(Object.entries(definitions).map(([name, t]) => [name, {description:t.description,inputSchema:t.inputSchema}]));
  const system = buildSystemPrompt({config:cfg,skillPrompts:skillSystemPrompts(cfg)});
  const model = await resolveModel(cfg);
  let modelRequests = 0;
  if (typeof model !== 'string') {
   const doStream = model.doStream.bind(model);
   model.doStream = options => { modelRequests++; return doStream(options); };
  }
  const effort = process.argv.find(x => x.startsWith('--effort='))?.split('=')[1];
  const start = Date.now(); const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 70000);
  console.log(JSON.stringify({provider:cfg.llm.provider,model:cfg.llm.model,effort:effort??'default',systemChars:system.length,tools:Object.keys(toolDefs)}));
  if (process.argv.includes('--flow')) {
   const { streamChat } = require('../src/main/agent/chat.ts');
   const originalLog = console.log;
   console.log = (...args) => { if (String(args[0]).startsWith('[opendex chat]')) return; originalLog(...args); };
   const safeTools = { ...toolDefs, updateResearch: definitions.updateResearch, openUrl: { ...toolDefs.openUrl, execute: async () => ({ error: 'Probe: no browser action executed.' }) } };
   const output = await streamChat({model,system,tools:safeTools,signal:abort.signal,
    messages:[{role:'user',content:'Research whether a heat pump makes sense for a home in Chicago. Read credible original sources, compare cold-weather performance and running costs, check incentives, and present cited findings. Update the research record as you work.'}],
    onDelta:() => {}, onToolResult:r=>originalLog(JSON.stringify({event:'tool-result',tool:r.toolName,stage:r.output?.stage,error:r.output?.error})), onToolCall: call => {
     originalLog(JSON.stringify({event:'tool-call',tool:call.toolName,stage:call.input?.stage,modelRequests,ms:Date.now()-start}));
     if(!['updateResearch','startResearch'].includes(call.toolName)) abort.abort();
    }});
   clearTimeout(timer); originalLog(JSON.stringify({done:true,ms:Date.now()-start,final:output.filter(m=>m.role==='assistant').at(-1)?.content})); app.exit(0); return;
  }
  const result = streamText({model,system,tools:toolDefs,maxRetries:0,abortSignal:abort.signal,
   ...(effort ? {providerOptions:{openai:{reasoningEffort:effort}}}:{}),
   prompt:'Research whether a heat pump makes sense for a home in Chicago. Read credible original sources, compare cold-weather performance and running costs, check incentives, and present cited findings. Update the research record as you work.'});
  const seen = new Set();
  for await (const part of result.fullStream) {
   if (!seen.has(part.type)) { seen.add(part.type); console.log(JSON.stringify({event:part.type,ms:Date.now()-start,...(part.type==='tool-call'?{tool:part.toolName}:{}),...(part.type==='error'?{errorName:part.error?.name,statusCode:part.error?.statusCode}: {})})); }
   if (part.type==='text-delta' || part.type==='tool-call') { abort.abort(); break; }
  }
  clearTimeout(timer); console.log(JSON.stringify({done:true,ms:Date.now()-start})); app.exit(0);
 } catch(e) { console.error(JSON.stringify({errorName:e?.name,statusCode:e?.statusCode})); app.exit(1); }
});
