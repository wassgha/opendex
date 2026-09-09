import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildToolSet } from '../src/skills/registry';
import { DEFAULT_CONFIG } from '../src/main/config/schema';
import type { PermissionRequestPayload } from '../src/main/ipc/channels';

const require = createRequire(import.meta.url);
function fixture() {
  const permissions: Record<string, string> = {};
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/main/agent/permissions.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => id === '../config/store' ? {
    getConfig: () => ({ skills: { permissions } }),
    updateConfig: (patch: any) => Object.assign(permissions, patch.skills.permissions),
  } : require(id), console, setTimeout, clearTimeout });
  const mod = exports as typeof import('../src/main/agent/permissions');
  const prompts: PermissionRequestPayload[] = [];
  mod.setPermissionUi({ present: p => prompts.push(p), dismiss: () => {} });
  let destroyed = false;
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed });
  const abort = new AbortController();
  const make = () => mod.makePermissionRequester(sender as any, abort.signal);
  return { mod, prompts, permissions, make, abort, destroy: () => { destroyed = true; sender.emit('destroyed'); } };
}

test('toolset startup and non-sensitive execution never present a permission prompt', async () => {
  const f = fixture();
  const tools = buildToolSet({ config: DEFAULT_CONFIG, requestPermission: f.make() });
  assert.equal(f.prompts.length, 0);
  await tools.getCurrentTime.execute!({}, { toolCallId: 'clock', messages: [] });
  assert.equal(f.prompts.length, 0);
  const result = tools.openUrl.execute!({ url: 'https://example.com' }, { toolCallId: 'open', messages: [] });
  assert.equal(f.prompts.length, 1, 'only execution of the sensitive tool prompts');
  f.mod.resolvePermission(f.prompts[0].id, 'deny');
  assert.deepEqual(await result, { error: 'Permission denied by the user.' });
});

test('parallel calls share one prompt; grant is reused only in its existing command scope', async () => {
  const f = fixture(), ask = f.make();
  const a = ask('open', 'Open', 'first'), b = ask('open', 'Open', 'second');
  assert.equal(f.prompts.length, 1);
  f.mod.resolvePermission(f.prompts[0].id, 'allow_once');
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(await ask('open', 'Open', 'third'), true);
  assert.equal(f.prompts.length, 1);
  const next = f.make()('open', 'Open', 'new command');
  assert.equal(f.prompts.length, 2);
  f.mod.recordAndResolve(f.prompts[1].id, 'open', 'always');
  assert.equal(await next, true);
  assert.equal(await f.make()('open', 'Open', 'standing consent'), true);
  assert.equal(f.prompts.length, 2);
  f.permissions.open = 'never';
  assert.equal(await ask('open', 'Open', 'revoked'), false);
});

test('different skills and fresh confirmations retain independent prompts', async () => {
  const f = fixture(), ask = f.make();
  f.permissions.git = 'always';
  const calls = [ask('open', 'Open', 'open'), ask('computer', 'Computer', 'click'),
    ask('git', 'Git', 'commit', { confirmEachCall: true }),
    ask('git', 'Git', 'pull', { confirmEachCall: true })];
  assert.equal(f.prompts.length, 4);
  for (const p of f.prompts) f.mod.resolvePermission(p.id, 'deny');
  assert.deepEqual(await Promise.all(calls), [false, false, false, false]);
  const retry = ask('open', 'Open', 'retry');
  assert.equal(f.prompts.length, 5, 'denial must not leave a cached pending decision');
  f.mod.resolvePermission(f.prompts[4].id, 'deny');
  assert.equal(await retry, false);
});

for (const stop of ['abort', 'destroy', 'revoke'] as const) {
  test(`${stop} rejects all callers sharing a pending prompt`, async () => {
    const f = fixture(), ask = f.make();
    const a = ask('open', 'Open', 'first'), b = ask('open', 'Open', 'second');
    if (stop === 'abort') f.abort.abort();
    if (stop === 'destroy') f.destroy();
    if (stop === 'revoke') f.permissions.open = 'never';
    f.mod.resolvePermission(f.prompts[0].id, 'allow_once');
    assert.deepEqual(await Promise.all([a, b]), [false, false]);
    assert.equal(f.mod.pendingPermissions(), 0);
    assert.equal(await ask('open', 'Open', 'after stop'), false);
  });
}
