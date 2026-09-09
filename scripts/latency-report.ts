import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { createLatencyStore, createSpanObserver, latencyReport, readLatencySamples } from '../src/main/diagnostics/latency-summary';

async function main() {
  const sample = process.argv.includes('--sample');
  const directory = sample ? await mkdtemp(join(tmpdir(), 'opendex-latency-')) : process.env.OPENDEX_DIAGNOSTICS_DIR ?? join(
    process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : process.platform === 'win32' ? process.env.APPDATA ?? join(homedir(), 'AppData/Roaming') : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'opendex', 'diagnostics');
  if (sample) {
    const store = createLatencyStore(directory);
    const observe = createSpanObserver('desktop-agent', store.add);
    observe('start', 0);
    observe('first-text', 1200);
    observe('tool-call', 1250, { call: 'fixture' });
    observe('tool-result', 1400, { call: 'fixture' });
    await store.flush();
  }
  console.log(JSON.stringify({ source: sample ? 'synthetic sample (not live acceptance)' : 'local timing summary',
    ...latencyReport(readLatencySamples(directory)) }, null, 2));
}
void main();
