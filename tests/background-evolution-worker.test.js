import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  backgroundEvolutionEnabled,
  createBackgroundEvolutionWorker,
  runBackgroundEvolutionTick,
} from '../src/harness-sidecar/meta/backgroundEvolutionWorker.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-background-evolution-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const enabledConfig = {
  productionCapabilities: {
    backgroundEvolution: { enabled: true },
    operatorDashboards: { enabled: true },
  },
  partialAutonomy: {
    enabled: true,
    thresholds: {
      minDashboardDepth: 1,
      maxRegressionCount: 0,
    },
  },
};

test('backgroundEvolutionEnabled respects production capability and feature flags', () => {
  assert.equal(backgroundEvolutionEnabled({}), false);
  assert.equal(backgroundEvolutionEnabled({
    productionCapabilities: { backgroundEvolution: { enabled: true } },
  }), true);
  assert.equal(backgroundEvolutionEnabled({
    features: { backgroundEvolution: true },
  }), true);
});

test('runTick skips when background evolution is disabled', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const worker = createBackgroundEvolutionWorker({
      workspaceRoot,
      loadHarnessConfig: async () => ({}),
    });

    const result = await worker.runTick();

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'background_evolution_disabled');
    assert.equal(result.canPromote, false);
    assert.equal(worker.getStatus().lastResult?.skipped, true);
  });
});

test('runBackgroundEvolutionTick persists autonomy evidence and returns evidence-only envelope', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runBackgroundEvolutionTick({
      workspaceRoot,
      harnessConfig: enabledConfig,
    });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.match(result.tickId, /^background-/);
    assert.ok(result.replay?.ran?.length >= 1);
    assert.ok(result.autonomy.dashboardDepth >= 1);

    const evidencePath = path.join(workspaceRoot, '.harness', 'meta', 'autonomy-evidence.json');
    const raw = await readFile(evidencePath, 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.dashboardDepth, result.autonomy.dashboardDepth);
    assert.equal(persisted.canPromote, false);
  });
});

test('runBackgroundEvolutionTick applies partial autonomy when thresholds are met', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runBackgroundEvolutionTick({
      workspaceRoot,
      harnessConfig: enabledConfig,
    });

    assert.ok(result.partialApply);
    assert.equal(result.partialApply.applied, true);
    assert.equal(result.partialApply.canPromote, false);

    const shadowPolicy = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'runtime', 'shadow-policy.json'),
      'utf8',
    ));
    assert.equal(shadowPolicy.evidenceOnly, true);
    assert.equal(shadowPolicy.canPromote, false);
    assert.ok(shadowPolicy.policyHints?.reportId);

    const ledger = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'meta', 'partial-autonomy-applied.json'),
      'utf8',
    ));
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].canPromote, false);
  });
});

test('runBackgroundEvolutionTick merges persisted autonomy evidence across ticks', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const evidencePath = path.join(workspaceRoot, '.harness', 'meta', 'autonomy-evidence.json');
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify({
      rollbackDrills: { total: 1, passed: 1, failed: 0 },
      regressionCount: 0,
      dashboardDepth: 1,
      dashboardSnapshotIds: ['existing-snap'],
      evidenceOnly: true,
      canPromote: false,
    }, null, 2)}\n`, 'utf8');

    const result = await runBackgroundEvolutionTick({
      workspaceRoot,
      harnessConfig: enabledConfig,
    });

    assert.ok(result.autonomy.dashboardDepth >= 2);
    assert.ok(result.autonomy.dashboardSnapshotIds.includes('existing-snap'));
  });
});

test('worker start, manual runTick, and stop expose status lifecycle', async () => {
  await withWorkspace(async (workspaceRoot) => {
    let configLoads = 0;
    const worker = createBackgroundEvolutionWorker({
      workspaceRoot,
      intervalMs: 60_000,
      loadHarnessConfig: async () => {
        configLoads += 1;
        return enabledConfig;
      },
    });

    assert.equal(worker.getStatus().running, false);
    assert.equal(worker.getStatus().intervalMs, 60_000);

    worker.start();
    assert.equal(worker.getStatus().running, true);

    const result = await worker.runTick();
    assert.equal(configLoads, 1);
    assert.match(result.tickId, /^background-/);
    assert.ok(worker.getStatus().lastTickAt instanceof Date);
    assert.equal(worker.getStatus().lastResult?.canPromote, false);

    worker.stop();
    assert.equal(worker.getStatus().running, false);
  });
});
