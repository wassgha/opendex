import { report, type Benchmark } from './core';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function page(run: Benchmark, nonce: string) {
  const s = run.current;
  const result = report(run, 'fixture');
  const finalTitle = result.summary?.status === 'succeeded' ? 'Benchmark complete' : result.summary?.status === 'error' ? 'Benchmark consistency error' : 'Benchmark ended';
  const step = s?.steps[run.step];
  const controls = s && run.started !== null ? step.controls.map(c => c.kind === 'button'
    ? `<button data-target="${c.id}">${escape(c.label)}</button>`
    : `<label data-target="${c.id}">${escape(c.label)}${c.kind === 'input' ? `<input data-target="${c.id}" maxlength="200" autocomplete="off">` : `<select data-target="${c.id}">${c.options!.map(o => `<option>${escape(o)}</option>`).join('')}</select>`}</label>`).join('') : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dex browser benchmark</title>
<style>body{font:20px system-ui;background:#f5f5f0;color:#172d32;margin:0}main{max-width:760px;margin:48px auto;padding:32px;background:white}h1{font-size:30px}label{display:block;margin:24px 0}input,select,button{font:inherit;padding:12px;margin:8px;border:1px solid #61777b;border-radius:4px}input,select{display:block;width:90%}button{cursor:pointer;background:#eef5f4}button:focus,input:focus,select:focus{outline:3px solid #1874a3}#error{color:#a32020}</style>
<main><p>Dex browser benchmark · ${Math.min(run.index + 1, run.suite.scenarios.length)} / ${run.suite.scenarios.length}</p><h1>${s ? escape(s.id) : finalTitle}</h1>
<p>${s ? escape(s.task) : escape(`Outcome: ${result.summary?.status}. ${result.summary?.succeeded}/${result.summary?.total} scenarios succeeded. ${result.consistency?.errors.join('; ') || 'Read the JSON and Markdown reports for measured results.'}`)}</p>
${s ? run.started === null ? '<p>Use computer controls to complete each task. Click Start scenario when ready. Continue through all scenarios. Do not use page source, scripting, developer tools or network APIs.</p><button id="start">Start scenario</button>' : `<h2>${escape(step.title)}</h2>${controls}` : ''}<p id="error" role="status"></p></main>
<script nonce="${nonce}">
let revision=${run.revision}, pending=0, queue=Promise.resolve();
async function send(path, body) {
 const r=await fetch(location.pathname+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok) throw Error(r.status===500 ? await r.text() : 'Benchmark request failed: '+r.status);
 return r.json();
}
document.addEventListener('click',e=>{
 if(!e.isTrusted) return;
 const element=e.target.closest('[data-target],#start');
 const starting=element?.id==='start';
 if(${run.started === null}&&!starting)return;
 const values=Object.fromEntries([...document.querySelectorAll('input,select')].map(c=>[c.dataset.target,c.value]));
 const body={revision,target:element?.dataset.target||'',values,x:e.clientX,y:e.clientY};
 pending++;
 queue=queue.then(async()=>{
 try{const state=await send(starting?'/start':'/click',starting?{}:body);if(state.revision!==revision)location.reload();else if(state.invalid)document.querySelector('#error').textContent='Check the requested values and try again.'}
 catch(err){document.querySelector('#error').textContent=err.message}finally{pending--}
 });
});
setInterval(async()=>{if(pending)return;try{const r=await fetch(location.pathname+'/state');if(r.ok&&(await r.json()).revision!==revision)location.reload()}catch{}},1000);
</script></html>`;
}
