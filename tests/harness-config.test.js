import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadHarnessConfig } from '../src/harness-sidecar/config/configLoader.js';

async function withTempWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-config-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('config loader returns safe defaults when no config file exists', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadHarnessConfig({ workspaceRoot });

    assert.equal(config.project.name, 'Helios Forge');
    assert.equal(config.defaults.modelProfile, 'qwen36_vlm_fast');
    assert.equal(config.permissions.mode, 'safe_edit');
    assert.equal(config.features.swarm, false);
    assert.equal(config.features.modelDrivenSwarm, false);
    assert.equal(config.features.piNativeSwarm, false);
  });
});

test('config loader reads harness yaml overrides', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, '.harness', 'config.yaml'),
      [
        'project:',
        '  name: AlphaHelion Lab',
        'defaults:',
        '  modelProfile: qwen36_vlm_deep',
        '  contextProfile: coding_large',
        'budgets:',
        '  maxToolCalls: 42',
        '  maxWallMinutes: 30',
        'permissions:',
        '  mode: review_required',
        '  allowedTools:',
        '    - shell.run',
        '    - github.search_issues',
        'features:',
        '  swarm: true',
        '  modelDrivenSwarm: true',
        '  piNativeSwarm: true',
        '  deepResearch: true',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = await loadHarnessConfig({ workspaceRoot });

    assert.equal(config.project.name, 'AlphaHelion Lab');
    assert.equal(config.defaults.modelProfile, 'qwen36_vlm_deep');
    assert.equal(config.defaults.contextProfile, 'coding_large');
    assert.equal(config.budgets.maxToolCalls, 42);
    assert.deepEqual(config.permissions.allowedTools, ['shell.run', 'github.search_issues']);
    assert.equal(config.features.swarm, true);
    assert.equal(config.features.modelDrivenSwarm, true);
    assert.equal(config.features.piNativeSwarm, true);
    assert.equal(config.features.deepResearch, true);
  });
});
