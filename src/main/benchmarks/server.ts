import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Benchmark, eventSchema, report, markdown, type Suite, type Report } from './core';
import { page } from './page';

export async function startBenchmarkServer({ suite, environment, out, baseline, port = 0, onComplete }: {
  suite: Suite; environment: string; out: string; baseline?: Report; port?: number;
  onComplete?: (result: Report) => Promise<void>;
}) {
  const run = new Benchmark(suite);
  if (baseline) { const check = new Benchmark(suite); check.stop(); markdown(report(check, environment), baseline); }
  await mkdir(out, { recursive: true, mode: 0o700 });
  const reportPath = join(out, 'report.json');
  await writeFile(reportPath, '', { flag: 'wx', mode: 0o600 });
  const token = randomBytes(24).toString('hex');
  const root = '/' + token;
  let origin = '';
  let writing = Promise.resolve();
  let persisted: Report | undefined;
  function save() {
    const snapshot = report(run, environment, baseline);
    const json = JSON.stringify(snapshot, null, 2) + '\n';
    const md = markdown(snapshot, baseline);
    writing = writing.then(async () => {
      for (const [path, content] of [[reportPath, json], [join(out, 'report.md'), md]]) {
        await writeFile(path + '.tmp', content, { mode: 0o600 });
        await rename(path + '.tmp', path);
        if (await readFile(path, 'utf8') !== content) throw Error('Benchmark persistence mismatch: saved report differs from fixture snapshot');
      }
      if (!snapshot.consistency?.ok) throw Error('Benchmark consistency error: ' + snapshot.consistency?.errors.join('; '));
      persisted = snapshot;
    });
    void writing.catch(fail);
    return writing;
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { res.writeHead(403).end(); return; }
      const path = req.url;
      if (req.method === 'GET' && path === root) {
        await writing;
        const nonce = randomBytes(16).toString('hex');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, 'Referrer-Policy': 'no-referrer' }).end(page(run, nonce)); return;
      }
      if (req.method === 'GET' && path === root + '/state') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ revision: run.revision })); return; }
      if (req.method !== 'POST' || ![root + '/start', root + '/click'].includes(path ?? '') || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413).end(); return; } }
      const input: unknown = JSON.parse(body);
      if (path === root + '/start') run.start(); else run.click(eventSchema.parse(input));
      await save();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ revision: run.revision, invalid: run.events.at(-1)?.outcome === 'invalid-submission' }));
    } catch (error) { console.error('Benchmark request failed:', error instanceof Error ? error.message : 'unknown error'); res.writeHead(failure ? 500 : 400).end(failure ? 'Benchmark recording failed: ' + failure : 'Invalid benchmark request'); }
  });
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing server address');
  origin = `http://127.0.0.1:${address.port}`;
  let completion: Promise<void> | undefined;
  let failure: string | undefined;
  let closed: Promise<void> | undefined;
  const complete = async () => {
    const saved = persisted;
    if (saved?.fixture?.complete && !failure) await (completion ??= Promise.resolve().then(() => onComplete?.(saved)));
  };
  const timer = setInterval(() => {
    const before = run.revision;
    run.tick();
    if (run.revision !== before) void save().catch(fail);
    void writing.then(complete).catch(fail);
  }, 100);
  timer.unref();
  server.unref();
  function fail(error: unknown) { failure = error instanceof Error ? error.message : String(error); clearInterval(timer); server.close(); }
  function close(reason?: string) {
    return closed ??= (async () => {
      clearInterval(timer); run.stop(reason);
      try { await save(); await complete(); }
      catch (error) { fail(error); throw error; }
      finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); }
    })();
  }
  try { await save(); } catch (error) { await close(); throw error; }
  return { url: origin + root, run, out, close, result: () => report(run, environment, baseline), get failure() { return failure; } };
}
