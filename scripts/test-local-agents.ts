import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { discoverLocalCodex } from "../src/main/maintenance/codex-client";

// Real child pipes exercise framing, process failures, and timeout cleanup.
function server(body: string) {
  return () => spawn(process.execPath, ["-e", `
    const rl=require('node:readline').createInterface({input:process.stdin});
    const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');
    const methods=[];
    rl.on('line',line=>{const m=JSON.parse(line);methods.push(m.method);${body}});
  `], { stdio: "pipe" });
}
const handshake = `if(m.method==='initialize') {send({id:m.id,result:{userAgent:'fixture'}}); return;}
  if(m.method==='initialized') return;`;

test("discovery attaches, pages, and projects task metadata using only read methods", async () => {
  const result = await discoverLocalCodex({ cwd: "/project", cursor: "page", limit: 2 }, { launch: server(handshake + `
    if(m.method==='thread/loaded/list'){send({id:m.id,result:{data:['active'],nextCursor:null}});return;}
    if(m.method==='thread/list'){
      const expected=['initialize','initialized','thread/loaded/list','thread/list'];
      if(JSON.stringify(methods)!==JSON.stringify(expected)||m.params.cwd!=='/project'||m.params.cursor!=='page'||m.params.useStateDbOnly!==true||m.params.limit!==2)process.exit(2);
      const response={id:m.id,result:{data:[{id:'active',name:'Exact title',cwd:'/project',status:{type:'active'},preview:'PRIVATE',turns:['PRIVATE']},{id:'stored',cwd:'/project'}],nextCursor:'next'}};
      const line=JSON.stringify(response)+'\\n';process.stdout.write(line.slice(0,13));setTimeout(()=>process.stdout.write(line.slice(13)),5);
    }
  `) });
  assert.equal(result.state, "connected");
  if (result.state !== "connected" || !result.tasks.length) throw new Error("No tasks");
  assert.deepEqual(result.tasks[0], { id: "active", title: "Exact title", cwd: "/project", status: "active", loaded: true });
  assert.equal(result.tasks[1].status, "unknown");
  assert.equal(result.nextCursor, "next");
  assert.equal(result.capabilities.messaging, false);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("missing connector is unavailable without starting another server", async () => {
  const result = await discoverLocalCodex({}, { executable: "/nonexistent/opendex-codex" });
  assert.equal(result.state, "unavailable");
  assert.equal(result.capabilities.discovery, false);
});

test("proxy exit returns a safe connection failure without forwarding stderr", async () => {
  const result = await discoverLocalCodex({}, { launch: () => spawn(process.execPath, ["-e", "process.stderr.write('PRIVATE');process.exit(1)"], { stdio: "pipe" }) });
  assert.equal(result.state, "unavailable");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("hung connections time out and terminate our proxy", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const result = await discoverLocalCodex({}, { timeoutMs: 100, launch: () => {
    child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "pipe" }); return child;
  } });
  assert.equal(result.state, "timeout");
  assert.equal(child?.killed, true);
});

test("invalid protocol and server errors remain failures and omit raw error content", async () => {
  for (const body of [`process.stdout.write('not json\\n');`, `send({id:m.id,error:{message:'PRIVATE'}});`, `send({id:m.id,result:{wrong:'PRIVATE'}});`]) {
    const result = await discoverLocalCodex({}, { launch: server(handshake + body) });
    assert.equal(result.state, "protocol");
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  }
});

test("oversized responses terminate discovery rather than growing memory indefinitely", async () => {
  const result = await discoverLocalCodex({}, { launch: server(`process.stdout.write('x'.repeat(2100000));`) });
  assert.equal(result.state, "protocol");
});

test("paginated loaded-task list leaves absent task load state unknown", async () => {
  const result = await discoverLocalCodex({}, { launch: server(handshake + `
    if(m.method==='thread/loaded/list')send({id:m.id,result:{data:[],nextCursor:'more'}});
    if(m.method==='thread/list')send({id:m.id,result:{data:[{id:'later',cwd:'/project'}]}});
  `) });
  assert.equal(result.tasks[0]?.loaded, null);
});
