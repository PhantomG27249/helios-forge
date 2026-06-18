import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  defaultPartialAutonomyThresholds,
  runAutonomyApplyOrchestrator,
  runPostTaskAutonomyApply,
} from '../src/harness-sidecar/meta/postTaskAutonomyApply.js';
import { LIVE_POLICY_REL } from '../src/harness-sidecar/meta/runtimePolicyStore.js';

const L3_THRESHOLDS = {
  minRollbackDrillsPassed: 1,
  maxRegressionCount: 0,
  minDashboardDepth: 1,
};

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-post-task-autonomy-'));
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
  },
  partialAutonomy: {
    enabled: true,
    maxLevel: 3,
    thresholds: L3_THRESHOLDS,
  },
  adaptiveSearch: { maxActionsPerTask: 8 },
  icr: { branchBreadth: 2, correctionDepth: 4 },
};

const eligibleAutonomyState = {
  rollbackDrills: { total: 1, passed: 1, failed: 0 },
  regressionCount: 0,
  dashboardDepth: 2,
  dashboardSnapshotIds: ['snap-1', 'snap-2'],
};

const replayReports = [{
  reportId: 'replay-post-task-1',
  suiteId: 'code-smoke',
  aggregateScore: 0.12,
  domainScores: { code: { delta: 0.12 } },
  regressions: [],
}];

test('defaultPartialAutonomyThresholds merges harness partialAutonomy.thresholds', () => {
  const thresholds = defaultPartialAutonomyThresholds({
    partialAutonomy: {
      thresholds: { minDashboardDepth: 2, maxRegressionCount: 1 },
    },
  });

  assert.equal(thresholds.minDashboardDepth, 2);
  assert.equal(thresholds.maxRegressionCount, 1);
});

test('runPostTaskAutonomyApply evaluates thresholds and skips apply when ineligible', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: enabledConfig,
      replayReports,
      autonomyState: {
        rollbackDrills: { total: 0, passed: 0, failed: 0 },
        regressionCount: 0,
        dashboardDepth: 0,
        dashboardSnapshotIds: [],
      },
    });

    assert.equal(result.thresholdEval.eligible, false);
    assert.equal(result.partialApply, null);
    assert.equal(result.livePolicyApply, null);
    assert.equal(result.thresholdEval.blockers.includes('dashboard_depth_insufficient'), true);
  });
});

test('runPostTaskAutonomyApply calls applyPartialAutonomousImprovements when eligible', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const events = [];
    const result = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: {
        ...enabledConfig,
        partialAutonomy: { enabled: true, maxLevel: 2, thresholds: L3_THRESHOLDS },
      },
      replayReports,
      autonomyState: eligibleAutonomyState,
      emitEvent: async (event) => { events.push(event); },
      now: () => new Date('2026-06-18T12:00:00.000Z'),
    });

    assert.equal(result.thresholdEval.eligible, true);
    assert.equal(result.partialApply.applied, true);
    assert.equal(result.livePolicyApply, null);
    assert.equal(events.some((event) => event.type === 'partial_autonomy.applied'), true);

    const shadowPolicy = JSON.parse(await readFile(result.partialApply.shadowPolicyPath, 'utf8'));
    assert.equal(shadowPolicy.policyHints.reportId, 'replay-post-task-1');
    assert.equal(shadowPolicy.partialAutonomy.level, 1);
  });
});

test('runPostTaskAutonomyApply writes live-policy.json at L3+ from consumer output', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: enabledConfig,
      replayReports,
      autonomyState: eligibleAutonomyState,
      now: () => new Date('2026-06-18T12:00:00.000Z'),
    });

    assert.equal(result.thresholdEval.eligible, true);
    assert.equal(result.partialApply.applied, true);
    assert.equal(result.livePolicyApply.applied, true);
    assert.match(result.livePolicyApply.livePolicyPath, /live-policy\.json$/);
    assert.equal(result.livePolicyApply.policyVersion, 'replay-post-task-1');

    const livePolicy = JSON.parse(await readFile(result.livePolicyApply.livePolicyPath, 'utf8'));
    assert.equal(livePolicy.policyVersion, 'replay-post-task-1');
    assert.equal(livePolicy.partialAutonomy.level, 3);
    assert.equal(livePolicy.partialAutonomy.levelName, 'reversible');
    assert.equal(livePolicy.harnessAdjustments.adaptiveSearch.maxActionsPerTask, 9);
    assert.equal(livePolicy.harnessAdjustments.icr.branchBreadth, 5);
    assert.equal(livePolicy.harnessAdjustments.icr.correctionDepth, 10);
    assert.equal(livePolicy.evidenceOnly, false);
    assert.equal(livePolicy.canPromote, false);
  });
});

test('runPostTaskAutonomyApply snapshots prior live-policy before L3 write', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtimeDir = path.join(workspaceRoot, '.harness', 'runtime');
    await mkdir(runtimeDir, { recursive: true });
    const priorLive = {
      schemaVersion: 1,
      policyVersion: 'replay-prior',
      policyHints: { reportId: 'replay-prior', aggregateScore: 0.05 },
      partialAutonomy: { level: 3, levelName: 'reversible' },
      harnessAdjustments: { adaptiveSearch: { maxActionsPerTask: 8 } },
      evidenceOnly: false,
    };
    await writeFile(
      path.join(runtimeDir, 'live-policy.json'),
      `${JSON.stringify(priorLive, null, 2)}\n`,
      'utf8',
    );

    const result = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: enabledConfig,
      replayReports,
      autonomyState: eligibleAutonomyState,
      now: () => new Date('2026-06-18T12:30:00.000Z'),
    });

    assert.equal(result.livePolicyApply.applied, true);
    const snapshotPath = path.join(
      workspaceRoot,
      '.harness',
      'runtime',
      'live-policy.snapshots',
      'replay-post-task-1.json',
    );
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.equal(snapshot.policyVersion, 'replay-prior');
    assert.equal(snapshot.policyHints.reportId, 'replay-prior');

    const livePolicy = JSON.parse(await readFile(result.livePolicyApply.livePolicyPath, 'utf8'));
    assert.equal(livePolicy.policyVersion, 'replay-post-task-1');
  });
});

test('runPostTaskAutonomyApply blocks L3 apply when regressions exceed threshold', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: enabledConfig,
      replayReports: [{
        ...replayReports[0],
        regressions: [{ caseId: 'c1', reason: 'score_regression' }],
      }],
      autonomyState: {
        ...eligibleAutonomyState,
        regressionCount: 1,
      },
    });

    assert.equal(result.thresholdEval.eligible, false);
    assert.equal(result.partialApply, null);
    assert.equal(result.livePolicyApply, null);
    assert.equal(result.thresholdEval.blockers.includes('regression_count_exceeded'), true);
  });
});

test('runAutonomyApplyOrchestrator is exported for background worker delegation', async () => {
  assert.equal(typeof runAutonomyApplyOrchestrator, 'function');

  await withWorkspace(async (workspaceRoot) => {
    const result = await runAutonomyApplyOrchestrator({
      workspaceRoot,
      harnessConfig: {
        ...enabledConfig,
        partialAutonomy: { enabled: true, maxLevel: 2, thresholds: L3_THRESHOLDS },
      },
      replayReports,
      autonomyState: eligibleAutonomyState,
      now: () => new Date('2026-06-18T13:00:00.000Z'),
    });

    assert.equal(result.thresholdEval.eligible, true);
    assert.equal(result.partialApply.applied, true);
  });
});

test('runPostTaskAutonomyApply never writes under src/', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });

    await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig: enabledConfig,
      replayReports,
      autonomyState: eligibleAutonomyState,
      now: () => new Date('2026-06-18T14:00:00.000Z'),
    });

    await assert.rejects(async () => readFile(path.join(workspaceRoot, 'src', 'probe.txt'), 'utf8'));
  });
});
