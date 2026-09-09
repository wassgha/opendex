import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const headers = require('node-api-headers').include_dir;
  const output = resolve(root, 'out/native');
  mkdirSync(output, { recursive: true });
  execFileSync('xcrun', ['clang', '-shared', '-fPIC', '-fobjc-arc', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8', '-I', headers,
    '-framework', 'Cocoa', '-framework', 'ApplicationServices', resolve(root, 'src/native/window-control.m'), '-o', resolve(output, 'window-control.node')], { stdio: 'inherit' });
}
