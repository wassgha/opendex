import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInteractionLog, redact } from '../src/main/diagnostics/interaction-log';
test('redacts common credentials and excludes raw media', () => {
  const result = JSON.stringify(redact({ text: 'sk-proj-123456789abcdefgh Bearer abcdef password=secret', audio: 'bytes', image: 'data' }));
  assert.ok(!result.includes('123456789')); assert.ok(!result.includes('abcdef'));
  assert.ok(!result.includes('=secret')); assert.ok(!result.includes('bytes'));
});
test('writes private parseable events and bounds rotation to three files', () => {
  const dir=mkdtempSync(join(tmpdir(),'dex-log-'));
  try {
    const write=createInteractionLog(dir, 150);
    for(let i=0;i<30;i++) write('user-transcript',{text:'hello', index:i});
    assert.ok(readdirSync(dir).length <= 3);
    const path=join(dir,'interactions.jsonl');
    const rows=readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l));
    assert.equal(rows.at(-1).index,29); assert.equal(statSync(path).mode & 0o777,0o600);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('logging failure never throws into the voice session', () => {
  const write=createInteractionLog('/dev/null/not-a-directory');
  assert.doesNotThrow(()=>write('test'));
});
