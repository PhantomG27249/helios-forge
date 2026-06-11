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
    assert.equal(config.features.multiModelSwarm, false);
    assert.equal(config.features.adaptiveModelRouter, false);
    assert.equal(config.features.adaptiveSearch, false);
    assert.equal(config.modelCouncil.enabled, false);
    assert.equal(config.modelCouncil.mode, 'advisory');
    assert.equal(config.modelCouncil.diversityRequired, 2);
    assert.equal(config.modelCouncil.disagreementThreshold, 0.35);
    assert.deepEqual(config.modelCouncil.roles, {});
    assert.deepEqual(config.modelCouncil.endpointProfiles, {});
    assert.equal(config.adaptiveSearch.mode, 'advisory');
    assert.equal(config.adaptiveSearch.maxActionsPerTask, 8);
    assert.equal(config.adaptiveSearch.allowProfileSwitching, true);
    assert.equal(config.modelRouter.enabled, false);
    assert.equal(config.modelRouter.mode, 'advisory');
    assert.equal(config.modelRouter.strategy, 'thompson_sampling');
    assert.equal(config.modelRouter.minEvidencePerArm, 5);
    assert.equal(config.modelRouter.explorationFloor, 0.05);
    assert.equal(config.modelRouter.maxArmsPerDecision, 8);
    assert.equal(config.modelRouter.rewardWeights.verifier, 0.4);
    assert.equal(config.modelRouter.rewardWeights.reviewer, 0.2);
    assert.equal(config.modelRouter.rewardWeights.councilAgreement, 0.15);
    assert.equal(config.modelRouter.rewardWeights.safety, 0.15);
    assert.equal(config.modelRouter.rewardWeights.latency, 0.05);
    assert.equal(config.modelRouter.rewardWeights.cost, 0.05);
    assert.equal(config.modelRouter.persistence.enabled, false);
    assert.equal(config.modelRouter.persistence.path, '.harness/model-router-state.json');
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
        '  adaptiveSearch: true',
        'adaptiveSearch:',
        '  mode: enabled',
        '  maxActionsPerTask: 3',
        '  allowProfileSwitching: false',
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
    assert.equal(config.features.adaptiveSearch, true);
    assert.equal(config.adaptiveSearch.mode, 'enabled');
    assert.equal(config.adaptiveSearch.maxActionsPerTask, 3);
    assert.equal(config.adaptiveSearch.allowProfileSwitching, false);
  });
});
