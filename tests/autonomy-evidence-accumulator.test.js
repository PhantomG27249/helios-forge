import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  accumulateAutonomyEvidence,
  evaluateAutonomyEvidenceThresholds,
} from '../src/harness-sidecar/meta/autonomyEvidenceAccumulator.js';

test('accumulator tracks rollback drill outcomes and replay regressions', () => {
  const state = accumulateAutonomyEvidence({
    rollbackDrill: {
      status: 'passed',
      evidenceOnly: true,
      canPromote: false,
    },
    replayReport: {
      replayId: 'replay_1',
      regressions: [{ caseId: 'c1', reason: 'score_regression' }],
    },
    dashboardSnapshot: { snapshotId: 'operator-2026-06-17' },
  });

  assert.equal(state.rollbackDrills.total, 1);
  assert.equal(state.rollbackDrills.passed, 1);
  assert.equal(state.rollbackDrills.failed, 0);
  assert.equal(state.regressionCount, 1);
  assert.equal(state.dashboardDepth, 1);
  assert.equal(state.evidenceOnly, true);
  assert.equal(state.canPromote, false);
});

test('accumulator merges with existing evidence state', () => {
  const first = accumulateAutonomyEvidence({
    rollbackDrill: { status: 'failed' },
    replayReport: { regressions: [{ caseId: 'c1' }] },
    dashboardSnapshot: { snapshotId: 'snap-1' },
  });
  const second = accumulateAutonomyEvidence({
    existing: first,
    rollbackDrill: { status: 'passed' },
    replayReport: { regressions: [] },
    dashboardSnapshot: { snapshotId: 'snap-2' },
  });

  assert.equal(second.rollbackDrills.total, 2);
  assert.equal(second.rollbackDrills.passed, 1);
  assert.equal(second.rollbackDrills.failed, 1);
  assert.equal(second.regressionCount, 1);
  assert.equal(second.dashboardDepth, 2);
});

test('threshold evaluation gates autonomy levels from accumulated evidence', () => {
  const state = accumulateAutonomyEvidence({
    rollbackDrill: { status: 'passed' },
    replayReport: { regressions: [] },
    dashboardSnapshot: { snapshotId: 'snap-1' },
  });

  const blocked = evaluateAutonomyEvidenceThresholds({
    state,
    thresholds: {
      minRollbackDrillsPassed: 2,
      maxRegressionCount: 0,
      minDashboardDepth: 3,
    },
  });

  assert.equal(blocked.eligible, false);
  assert.equal(blocked.canPromote, false);
  assert.equal(blocked.blockers.includes('rollback_drills_insufficient'), true);
  assert.equal(blocked.blockers.includes('dashboard_depth_insufficient'), true);

  const expanded = accumulateAutonomyEvidence({
    existing: state,
    rollbackDrill: { status: 'passed' },
    dashboardSnapshot: { snapshotId: 'snap-2' },
  });
  const ready = evaluateAutonomyEvidenceThresholds({
    state: expanded,
    thresholds: {
      minRollbackDrillsPassed: 2,
      maxRegressionCount: 0,
      minDashboardDepth: 2,
    },
  });

  assert.equal(ready.eligible, true);
  assert.equal(ready.canPromote, false);
  assert.equal(ready.authority, 'evidence_only');
});
