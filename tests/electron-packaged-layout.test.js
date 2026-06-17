import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredPackagedFiles = [
  'src/server.js',
  'src/electron/main.js',
  'src/electron/preload.js',
  'public/index.html',
  'packages/helios-research-harness/helios-package.json',
];

test('packaged layout includes required application files', async () => {
  for (const relativePath of requiredPackagedFiles) {
    const filePath = path.join(repoRoot, relativePath);
    const fileStat = await stat(filePath);
    assert.ok(fileStat.isFile(), `${relativePath} must be a file`);
    assert.ok(fileStat.size > 0, `${relativePath} must not be empty`);
  }
});

test('electron-builder config declares app id and bundled harness extraResources', async () => {
  const configText = await readFile(path.join(repoRoot, 'electron-builder.yml'), 'utf8');
  assert.match(configText, /appId:\s*com\.alphahelion\.helios-forge/);
  assert.match(configText, /helios-research-harness/);
  assert.match(configText, /asarUnpack/);
});

test('desktop icon assets exist', async () => {
  for (const relativePath of ['build/icon.png', 'build/icon.ico', 'public/icon.png']) {
    const filePath = path.join(repoRoot, relativePath);
    const fileStat = await stat(filePath);
    assert.ok(fileStat.size > 0, `${relativePath} must not be empty`);
  }
});
