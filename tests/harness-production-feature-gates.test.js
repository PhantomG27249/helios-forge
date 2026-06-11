import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadHarnessConfig } from '../src/harness-sidecar/config/configLoader.js';

const EXPECTED_PRODUCTION_GATES = {
  modelAssistedMemory: 'offline',
  modelBackedRhoEmbeddings: 'offline',
  productionA2aTransport: 'offline',
  productionA2aQueues: 'offline',
  visualSwarmCell: 'offline',
  visualReplaySuites: 'offline',
  modelAssistedBesJudgment: 'offline',
  councilDebate: 'advisory',
  ensembleCalibration: 'advisory',
  endpointCapacityRecommendations: 'advisory',
  operatorDashboards: 'advisory',
  productionAutonomyPolicy: 'advisory',
};

async function withTempWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-production-gates-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('production organism feature gates default to disabled offline or advisory mode', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadHarnessConfig({ workspaceRoot });

    for (const [gateName, expectedMode] of Object.entries(EXPECTED_PRODUCTION_GATES)) {
      const gate = config.productionCapabilities[gateName];
      assert.equal(gate.enabled, false, `${gateName} should default disabled`);
      assert.equal(gate.mode, expectedMode, `${gateName} should default to ${expectedMode}`);
      assert.equal(gate.authority, 'evidence_only', `${gateName} should not own authority`);
    }
  });
});

test('production organism feature gates can be explicitly enabled without changing authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, '.harness', 'config.json'),
      JSON.stringify({
        productionCapabilities: {
          visualSwarmCell: { enabled: true, mode: 'advisory' },
          productionAutonomyPolicy: { enabled: true, mode: 'advisory' },
        },
      }),
      'utf8',
    );

    const config = await loadHarnessConfig({ workspaceRoot });

    assert.equal(config.productionCapabilities.visualSwarmCell.enabled, true);
    assert.equal(config.productionCapabilities.visualSwarmCell.mode, 'advisory');
    assert.equal(config.productionCapabilities.visualSwarmCell.authority, 'evidence_only');
    assert.equal(config.productionCapabilities.productionAutonomyPolicy.enabled, true);
    assert.equal(config.productionCapabilities.productionAutonomyPolicy.authority, 'evidence_only');
    assert.equal(config.productionCapabilities.productionA2aTransport.enabled, false);
    assert.equal(config.productionCapabilities.productionA2aTransport.mode, 'offline');
  });
});
