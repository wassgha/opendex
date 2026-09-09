import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as schema from '../src/main/config/schema';
import { buildToolSet } from '../src/skills/registry';
import { selfEnhancementSkill } from '../src/skills/self-enhancement/skill';
import { startDexEnhancement, tuneDex } from '../src/main/maintenance/self-enhancement';
import type { PermissionRequestPayload } from '../src/main/ipc/channels';

const require = createRequire(import.meta.url);
// Execute the real store/requester with only Electron and its userData replaced.
// This exercises disk persistence and reload without touching the user's profile.
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => dependencies[id] ?? require(id),
    console, setTimeout, clearTimeout, structuredClone, Buffer, process: { env: {} } });
  return exports as T;
}

test('enhancement dispatches reuse persisted Always across commands/reload; Ask and Never retain their gates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dex-enhancement-permissions-'));
  const originalReady = selfEnhancementSkill.isReady;
  const originals = selfEnhancementSkill.tools.map(t => t.execute);
  const prompts: PermissionRequestPayload[] = [];
  let dispatches = 0;
  const deps = {
    source: async () => ({ packaged: false, appPath: process.cwd() }),
    create: async (input: { operationId: string }) => {
      dispatches++;
      return { state: 'accepted', operationId: input.operationId };
    },
  };
  const loadStore = () => load<typeof import('../src/main/config/store')>('../src/main/config/store.ts', {
    electron: { app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false } },
    './schema': schema,
  });
  let store = loadStore();
  const permissions = load<typeof import('../src/main/agent/permissions')>('../src/main/agent/permissions.ts', {
    '../config/store': { getConfig: () => store.getConfig(), updateConfig: (patch: schema.DeepPartial<schema.OpenDexConfig>) => store.updateConfig(patch) },
  });
  permissions.setPermissionUi({ present: p => prompts.push(p), dismiss: () => {} });
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const freshTools = () => buildToolSet({ config: store.getConfig(), requestPermission: permissions.makePermissionRequester(sender as any) });
  const input = { operationId: '49b4e83e-e3cb-48ab-a690-bae8028ddf84', request: 'Test request', gap: 'Test gap', acceptance: 'Test acceptance' };
  const execute = (tools: ReturnType<typeof freshTools>, name = 'startDexEnhancement') =>
    tools[name].execute!({ ...input, operationId: randomUUID() }, { toolCallId: 'test', messages: [] });
  try {
    selfEnhancementSkill.isReady = () => true;
    // Substitute the desktop boundary only: retain registry authorization and
    // real enhancement validation/prompt construction; never create a live task.
    for (const tool of selfEnhancementSkill.tools) {
      if (tool.name === 'startDexEnhancement') tool.execute = value => startDexEnhancement(value, deps);
      if (tool.name === 'tuneDex') tool.execute = (value: { operationId: string }) => tuneDex(value.operationId, deps);
    }
    store.updateConfig({ skills: { enabled: { 'self-enhancement': true } } });
    const first = execute(freshTools());
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].skillId, 'self-enhancement');
    assert.equal(dispatches, 0);
    permissions.recordAndResolve(prompts[0].id, prompts[0].skillId, 'always');
    assert.equal((await first as any).state, 'accepted');
    assert.equal(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).skills.permissions['self-enhancement'], 'always');
    store = loadStore();
    for (const name of ['startDexEnhancement', 'tuneDex', 'startDexEnhancement']) {
      assert.equal((await execute(freshTools(), name) as any).state, 'accepted');
    }
    assert.equal(dispatches, 4);
    assert.equal(prompts.length, 1, 'Always must survive new requesters and disk reload');

    const existingTools = freshTools();
    store.updateConfig({ skills: { permissions: { 'self-enhancement': 'never' } } });
    for (const tools of [existingTools, freshTools()]) {
      assert.deepEqual(await execute(tools), { error: 'Permission denied by the user.' });
    }
    assert.equal(dispatches, 4);
    assert.equal(prompts.length, 1, 'Never refuses without a new prompt');

    store.updateConfig({ skills: { permissions: { 'self-enhancement': 'ask' } } });
    const denied = execute(freshTools());
    assert.equal(prompts.length, 2);
    permissions.recordAndResolve(prompts[1].id, prompts[1].skillId, 'deny');
    assert.deepEqual(await denied, { error: 'Permission denied by the user.' });
    assert.equal(dispatches, 4);
    const once = execute(freshTools(), 'tuneDex');
    permissions.recordAndResolve(prompts[2].id, prompts[2].skillId, 'allow_once');
    assert.equal((await once as any).state, 'accepted');
    const next = execute(freshTools());
    assert.equal(prompts.length, 4, 'Allow once does not become standing consent');
    permissions.recordAndResolve(prompts[3].id, prompts[3].skillId, 'deny');
    await next;
    assert.equal(dispatches, 5);
    store.updateConfig({ skills: { enabled: { 'self-enhancement': false }, permissions: { 'self-enhancement': 'always' } } });
    assert.equal(freshTools().startDexEnhancement, undefined);
    assert.equal(freshTools().tuneDex, undefined);
  } finally {
    for (const p of prompts) permissions.resolvePermission(p.id, 'deny');
    selfEnhancementSkill.isReady = originalReady;
    selfEnhancementSkill.tools.forEach((tool, i) => { tool.execute = originals[i]; });
    rmSync(directory, { recursive: true, force: true });
  }
});
