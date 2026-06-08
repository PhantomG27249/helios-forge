import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadVerifierRegistry } from '../src/harness-sidecar/tools/verifierRegistry.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-verifier-registry-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('verifier registry derives safe defaults from package scripts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node --test',
        'release:smoke': 'node scripts/release-smoke.js',
      },
    }));

    const registry = await loadVerifierRegistry({ workspaceRoot });

    assert.equal(registry.version, 1);
    assert.deepEqual(registry.verifiers.map((verifier) => verifier.name), ['unit', 'release-smoke']);
    assert.equal(registry.byName.unit.command, 'npm test');
    assert.equal(registry.byName['release-smoke'].command, 'npm run release:smoke');
    assert.equal(registry.byName.unit.cwd, null);
  });
});

test('verifier registry loads json and yaml harness verifier records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      version: 1,
      verifiers: [{
        name: 'vlm-focused',
        command: 'npm test -- tests/harness-vlm-native.test.js',
        kind: 'visual',
        cwd: '.',
        appliesTo: ['src/harness-sidecar/vlm/**/*.js'],
        tags: ['vlm'],
      }],
    }));

    let registry = await loadVerifierRegistry({ workspaceRoot });
    assert.equal(registry.byName['vlm-focused'].kind, 'visual');
    assert.deepEqual(registry.byName['vlm-focused'].appliesTo, ['src/harness-sidecar/vlm/**/*.js']);

    await rm(path.join(harnessDir, 'verifiers.json'));
    await writeFile(path.join(harnessDir, 'verifiers.yaml'), [
      'version: 1',
      'verifiers:',
      '  - name: smoke',
      '    command: npm run release:smoke',
      '    kind: smoke',
      '    risk: medium',
      '    timeoutMs: 90000',
      '    appliesTo:',
      '      - src/**/*.js',
      '    tags:',
      '      - default',
      '',
    ].join('\n'));

    registry = await loadVerifierRegistry({ workspaceRoot });
    assert.equal(registry.byName.smoke.command, 'npm run release:smoke');
    assert.equal(registry.byName.smoke.timeoutMs, 90000);
    assert.deepEqual(registry.byName.smoke.tags, ['default']);
  });
});

test('verifier registry rejects unsafe verifier cwd values', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      verifiers: [{
        name: 'unsafe',
        command: 'npm test',
        cwd: '..',
      }],
    }));

    await assert.rejects(
      () => loadVerifierRegistry({ workspaceRoot }),
      /outside workspace/i,
    );
  });
});
