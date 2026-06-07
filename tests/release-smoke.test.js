import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkReleaseFiles } from '../scripts/release-smoke.js';

async function makeReleaseRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'helios-release-smoke-'));
  await mkdir(path.join(root, 'src', 'electron'), { recursive: true });
  await mkdir(path.join(root, 'public'), { recursive: true });
  await writeFile(path.join(root, 'src', 'server.js'), 'console.log("server");\n');
  await writeFile(path.join(root, 'src', 'electron', 'main.js'), 'console.log("main");\n');
  await writeFile(path.join(root, 'src', 'electron', 'preload.js'), 'console.log("preload");\n');
  await writeFile(path.join(root, 'public', 'index.html'), '<main>Helios</main>\n');
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      main: 'src/electron/main.js',
      scripts: {
        electron: 'electron src/electron/main.js',
        test: 'node --test',
      },
      dependencies: {
        ws: '^8.18.0',
      },
      devDependencies: {
        electron: '^33.0.0',
      },
    }),
  );
  return root;
}

test('release smoke passes when package entrypoints and scripts are present', async () => {
  const root = await makeReleaseRoot();

  const result = await checkReleaseFiles(root);

  assert.deepEqual(result.errors, []);
  assert.ok(result.checked.includes('src/electron/main.js'));
  assert.ok(result.checked.includes('public/index.html'));
});

test('release smoke reports missing Electron entrypoint files', async () => {
  const root = await makeReleaseRoot();
  await writeFile(path.join(root, 'src', 'electron', 'preload.js'), '');

  const result = await checkReleaseFiles(root);

  assert.match(result.errors.join('\n'), /src\/electron\/preload\.js is empty/);
});
