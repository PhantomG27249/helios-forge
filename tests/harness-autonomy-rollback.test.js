import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  derivePromotionLoopAutonomySignal,
  evaluateL3LivePolicyApply,
  processReplayReportForAutonomy,
  runAutonomyRollbackDrill,
} from '../src/harness-sidecar/meta/autonomyRollbackRunner.js';
import { LIVE_POLICY_REL } from '../src/harness-sidecar/meta/runtimePolicyStore.js';

const L3_THRESHOLDS = {
  minRollbackDrillsPassed: 1,
  maxRegressionCount: 0,
  minDashboardDepth: 1,
};

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-autonomy-rollback-'));
  await mkdir(path.join(workspaceRoot, '.harness', 'runtime'), { recursive: true });
  await mkdir(path.join(workspaceRoot, '.harness', 'governance'), { recursive: true });
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('replay report with regressions increments state and blocks L3 apply', () => {
  const { state, l3Apply } = processReplayReportForAutonomy({
    existing: {
      rollbackDrills: { total: 1, passed: 1, failed: 0 },
      dashboardDepth: 1,
      dashboardSnapshotIds: ['snap-1'],
      regressionCount: 0,
    },
    replayReport: {
      reportId: 'replay-regressed',
      regressions: [{ caseId: 'c1', reason: 'score_regression' }],
    },
    thresholds: L3_THRESHOLDS,
  });

  assert.equal(state.regressionCount, 1);
  assert.equal(l3Apply.allowed, false);
  assert.equal(l3Apply.canPromote, false);
  assert.equal(l3Apply.evidenceOnly, true);
  assert.equal(l3Apply.blockers.includes('regression_count_exceeded'), true);
});

test('runAutonomyRollbackDrill restores prior live-policy.json snapshot', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const priorPolicy = {
      schemaVersion: 1,
      policyVersion: 'pv-1',
      policyHints: { reportId: 'replay-safe', aggregateScore: 0.08 },
      partialAutonomy: { level: 3, levelName: 'reversible' },
      evidenceOnly: true,
      canPromote: false,
    };
    const modifiedPolicy = {
      ...priorPolicy,
      policyVersion: 'pv-2',
      policyHints: { reportId: 'replay-risky', aggregateScore: -0.2 },
    };

    const snapshotDir = path.join(workspaceRoot, '.harness', 'runtime', 'live-policy.snapshots');
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(
      path.join(snapshotDir, 'pv-1.json'),
      `${JSON.stringify(priorPolicy, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, LIVE_POLICY_REL),
      `${JSON.stringify(modifiedPolicy, null, 2)}\n`,
      'utf8',
    );

    const drill = await runAutonomyRollbackDrill({
      workspaceRoot,
      policyVersion: 'pv-1',
      now: () => new Date('2026-06-18T12:00:00.000Z'),
    });

    const restored = JSON.parse(await readFile(path.join(workspaceRoot, LIVE_POLICY_REL), 'utf8'));

    assert.equal(drill.status, 'passed');
    assert.equal(drill.restoreVerified, true);
    assert.equal(restored.policyVersion, 'pv-1');
    assert.equal(restored.policyHints.reportId, 'replay-safe');
    assert.equal(restored.policyHints.aggregateScore, 0.08);
  });
});

test('runAutonomyRollbackDrill persists drill to rollback-drills.json', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const priorPolicy = {
      schemaVersion: 1,
      policyVersion: 'pv-persist',
      policyHints: { reportId: 'replay-persist' },
      evidenceOnly: true,
    };
    const snapshotDir = path.join(workspaceRoot, '.harness', 'runtime', 'live-policy.snapshots');
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(path.join(snapshotDir, 'pv-persist.json'), `${JSON.stringify(priorPolicy, null, 2)}\n`, 'utf8');
    await writeFile(
      path.join(workspaceRoot, LIVE_POLICY_REL),
      `${JSON.stringify({ ...priorPolicy, policyVersion: 'pv-next' }, null, 2)}\n`,
      'utf8',
    );

    await runAutonomyRollbackDrill({
      workspaceRoot,
      policyVersion: 'pv-persist',
      now: () => new Date('2026-06-18T12:05:00.000Z'),
    });

    const raw = await readFile(
      path.join(workspaceRoot, '.harness', 'governance', 'rollback-drills.json'),
      'utf8',
    );
    const payload = JSON.parse(raw);

    assert.equal(payload.drills.length, 1);
    assert.equal(payload.drills[0].policyVersion, 'pv-persist');
    assert.equal(payload.drills[0].status, 'passed');
    assert.equal(payload.summary.passed, 1);
    assert.equal(payload.canPromote, false);
    assert.equal(payload.evidenceOnly, true);
  });
});

test('runAutonomyRollbackDrill emits governance.rollback_drill_completed', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const priorPolicy = {
      schemaVersion: 1,
      policyVersion: 'pv-event',
      policyHints: { reportId: 'replay-event' },
    };
    const snapshotDir = path.join(workspaceRoot, '.harness', 'runtime', 'live-policy.snapshots');
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(path.join(snapshotDir, 'pv-event.json'), `${JSON.stringify(priorPolicy, null, 2)}\n`, 'utf8');
    await writeFile(
      path.join(workspaceRoot, LIVE_POLICY_REL),
      `${JSON.stringify({ ...priorPolicy, policyVersion: 'pv-bad' }, null, 2)}\n`,
      'utf8',
    );

    const events = [];
    await runAutonomyRollbackDrill({
      workspaceRoot,
      policyVersion: 'pv-event',
      emitEvent: async (event) => { events.push(event); },
      now: () => new Date('2026-06-18T12:10:00.000Z'),
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'governance.rollback_drill_completed');
    assert.equal(events[0].policyVersion, 'pv-event');
    assert.equal(events[0].status, 'passed');
    assert.equal(events[0].canPromote, false);
    assert.equal(events[0].evidenceOnly, true);
  });
});

test('L4 promotion eligibility signal is evidence-only and never bypasses promotion', () => {
  const readyState = {
    rollbackDrills: { total: 2, passed: 2, failed: 0 },
    regressionCount: 0,
    dashboardDepth: 2,
    dashboardSnapshotIds: ['snap-1', 'snap-2'],
  };

  const signal = derivePromotionLoopAutonomySignal({
    autonomyState: readyState,
    thresholds: L3_THRESHOLDS,
  });

  assert.equal(signal.l4Eligible, true);
  assert.equal(signal.signalOnly, true);
  assert.equal(signal.promotionBypass, false);
  assert.equal(signal.canPromote, false);
  assert.equal(signal.authority, 'eligibility_only');
  assert.equal(signal.autonomyLevel, 4);

  const blocked = derivePromotionLoopAutonomySignal({
    autonomyState: {
      ...readyState,
      regressionCount: 1,
    },
    thresholds: L3_THRESHOLDS,
  });

  assert.equal(blocked.l4Eligible, false);
  assert.equal(blocked.blockers.includes('regression_count_exceeded'), true);
  assert.equal(blocked.canPromote, false);
});

test('evaluateL3LivePolicyApply allows apply when thresholds are satisfied', () => {
  const result = evaluateL3LivePolicyApply({
    autonomyState: {
      rollbackDrills: { total: 1, passed: 1, failed: 0 },
      regressionCount: 0,
      dashboardDepth: 1,
      dashboardSnapshotIds: ['snap-1'],
    },
    thresholds: L3_THRESHOLDS,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.canPromote, false);
});
