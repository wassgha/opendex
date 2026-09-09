import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitRepository, parseStatus } from "../src/skills/git/repository";
import { buildToolSet } from "../src/skills/registry";
import { DEFAULT_CONFIG, mergeConfig } from "../src/main/config/schema";
import { buildRealtimeToolDefs } from "../src/main/agent/realtime/realtime-tools";
const exec = promisify(execFile);
test("porcelain preserves unusual filenames, renames and conflict counts", () => {
  const s = parseStatus('## main...origin/main [ahead 2, behind 3]\0 M a b\0?? newline\nfile\0R  new\0old\0UU conflict\0');
  assert.equal(s.ahead, 2); assert.equal(s.behind, 3);
  assert.deepEqual(s.modified, ['a b', 'new', 'conflict']);
  assert.deepEqual(s.untracked, ['newline\nfile']);
  assert.deepEqual(s.conflicts, ['conflict']);
});
test("real git status, staged-only commit, dirty pull and hook policy", async () => {
  const root = await mkdtemp(join(tmpdir(), 'dex-git-'));
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  try {
    await mkdir(join(root, 'src/main'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"opendex"}');
    await writeFile(join(root, 'src/main/index.ts'), 'initial');
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'commit.gpgSign', 'false');
    await git('add', '.'); await git('commit', '-m', 'initial');
    const repo = new GitRepository(async () => ({ packaged: false, appPath: root }));
    assert.equal((await repo.status()).ok, true);
    assert.match((await repo.action('commit', 'empty')).error!, /Nothing is staged/);
    await writeFile(join(root, 'src/main/index.ts'), 'staged'); await git('add', 'src/main/index.ts');
    await writeFile(join(root, 'untracked'), 'keep');
    assert.match((await repo.action('pull')).error!, /clean checkout/);
    assert.equal((await repo.action('commit', 'literal $(do-not-run)')).ok, true);
    assert.equal((await git('show', 'HEAD:src/main/index.ts')).stdout, 'staged');
    assert.equal(await readFile(join(root, 'untracked'), 'utf8'), 'keep');
    await writeFile(join(root, 'src/main/index.ts'), 'next'); await git('add', 'src/main/index.ts');
    await writeFile(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.ok((await repo.action('commit', 'blocked by hook')).error);
    assert.equal((await git('log', '-1', '--format=%s')).stdout.trim(), 'literal $(do-not-run)');
    await writeFile(join(root, '.git/MERGE_HEAD'), 'pending');
    assert.match((await repo.action('commit', 'must not finish merge')).error!, /pending merge/);
    assert.ok((await new GitRepository(async () => ({ packaged: true, appPath: root })).status()).error);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("both voice modes expose git and mutation requests require fresh confirmation", async () => {
  assert.ok(buildRealtimeToolDefs(DEFAULT_CONFIG).some(t => t.name === 'getDexGitStatus'));
  const requests: unknown[] = [];
  const tools = buildToolSet({ config: DEFAULT_CONFIG, requestPermission: async (...args) => { requests.push(args); return false; } });
  const result = await tools.controlDexGit.execute!({ action: 'commit', message: 'test' }, { toolCallId: 'fixture', messages: [] });
  assert.deepEqual(result, { error: 'Permission denied by the user.' });
  assert.deepEqual((requests[0] as unknown[])[3], { confirmEachCall: true });
  const disabled = mergeConfig(DEFAULT_CONFIG, { skills: { enabled: { git: false } } });
  assert.equal(buildToolSet({ config: disabled, requestPermission: async () => true }).getDexGitStatus, undefined);
});
test("real local upstream fast-forwards and refuses divergence without merging", async () => {
  const root = await mkdtemp(join(tmpdir(), 'dex-git-pull-'));
  const upstream = join(root, 'upstream'), checkout = join(root, 'checkout');
  const git = (cwd: string, ...args: string[]) => exec('git', args, { cwd });
  try {
    await mkdir(join(upstream, 'src/main'), { recursive: true });
    await writeFile(join(upstream, 'package.json'), '{"name":"opendex"}');
    await writeFile(join(upstream, 'src/main/index.ts'), 'initial');
    await git(upstream, 'init', '-b', 'main');
    await git(upstream, 'config', 'user.name', 'Fixture'); await git(upstream, 'config', 'user.email', 'fixture@example.invalid');
    await git(upstream, 'config', 'commit.gpgSign', 'false');
    await git(upstream, 'add', '.'); await git(upstream, 'commit', '-m', 'initial');
    await git(root, 'clone', upstream, checkout);
    await git(checkout, 'config', 'user.name', 'Fixture'); await git(checkout, 'config', 'user.email', 'fixture@example.invalid');
    await git(checkout, 'config', 'commit.gpgSign', 'false');
    const repo = new GitRepository(async () => ({ packaged: false, appPath: checkout }));
    await writeFile(join(upstream, 'remote'), 'new'); await git(upstream, 'add', '.'); await git(upstream, 'commit', '-m', 'remote');
    assert.equal((await repo.action('pull')).ok, true);
    assert.equal(await readFile(join(checkout, 'remote'), 'utf8'), 'new');
    await writeFile(join(checkout, 'local'), 'local'); await git(checkout, 'add', '.'); await git(checkout, 'commit', '-m', 'local');
    const oldHead = (await git(checkout, 'rev-parse', 'HEAD')).stdout;
    await writeFile(join(upstream, 'remote'), 'divergent'); await git(upstream, 'add', '.'); await git(upstream, 'commit', '-m', 'divergent');
    assert.ok((await repo.action('pull')).error);
    assert.equal((await git(checkout, 'rev-parse', 'HEAD')).stdout, oldHead);
    const s = await repo.status();
    if (!s.ok) assert.fail(s.error);
    assert.equal(s.ahead, 1); assert.equal(s.behind, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('commit validation stays local without the provider-breaking schema pattern', async () => {
  const { gitSkill } = await import('../src/skills/git/skill');
  const { z } = await import('zod');
  const schema = gitSkill.tools.find(t => t.name === 'controlDexGit')!.inputSchema;
  const json = z.toJSONSchema(schema) as any;
  assert.equal(json.properties.message.pattern, undefined);
  for (const message of ['line\nbreak', 'carriage\rreturn', 'nul\0byte', '', 'x'.repeat(501)]) {
    assert.equal(schema.safeParse({ action: 'commit', message }).success, false);
  }
  assert.equal(schema.safeParse({ action: 'commit', message: 'Valid message' }).success, true);
});
