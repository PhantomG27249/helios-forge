import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveAppPaths } from '../src/electron/appPaths.js';

test('resolveAppPaths uses repo layout in development', () => {
  const repoRoot = path.resolve('fixtures/repo');
  const paths = resolveAppPaths({
    isPackaged: false,
    appPath: path.join(repoRoot, 'src', 'electron'),
    resourcesPath: path.join(repoRoot, 'resources'),
    dirname: path.join(repoRoot, 'src', 'electron'),
  });

  assert.equal(paths.appRoot, repoRoot);
  assert.equal(paths.serverEntry, path.join(repoRoot, 'src', 'server.js'));
  assert.equal(paths.publicDir, path.join(repoRoot, 'public'));
  assert.equal(paths.bundledHarnessPackage, path.join(repoRoot, 'packages', 'helios-research-harness'));
});

test('resolveAppPaths uses resources layout when packaged', () => {
  const resourcesPath = path.resolve('fixtures/resources');
  const paths = resolveAppPaths({
    isPackaged: true,
    appPath: path.join(resourcesPath, 'app.asar'),
    resourcesPath,
    dirname: path.join(resourcesPath, 'app.asar', 'src', 'electron'),
  });

  assert.equal(paths.appRoot, path.join(resourcesPath, 'app.asar'));
  assert.equal(paths.bundledHarnessPackage, path.join(resourcesPath, 'helios-research-harness'));
});
