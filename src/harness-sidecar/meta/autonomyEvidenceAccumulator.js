function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultState(existing = {}) {
  return {
    rollbackDrills: {
      total: existing.rollbackDrills?.total || 0,
      passed: existing.rollbackDrills?.passed || 0,
      failed: existing.rollbackDrills?.failed || 0,
    },
    regressionCount: existing.regressionCount || 0,
    dashboardDepth: existing.dashboardDepth || 0,
    dashboardSnapshotIds: [...asArray(existing.dashboardSnapshotIds)],
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
}

export function accumulateAutonomyEvidence({
  existing = {},
  rollbackDrill,
  replayReport,
  dashboardSnapshot,
} = {}) {
  const state = defaultState(existing);

  if (rollbackDrill) {
    state.rollbackDrills.total += 1;
    if (rollbackDrill.status === 'passed') {
      state.rollbackDrills.passed += 1;
    } else {
      state.rollbackDrills.failed += 1;
    }
  }

  if (replayReport) {
    state.regressionCount += asArray(replayReport.regressions).length;
  }

  if (dashboardSnapshot) {
    const snapshotId = dashboardSnapshot.snapshotId || dashboardSnapshot.id;
    if (snapshotId && !state.dashboardSnapshotIds.includes(snapshotId)) {
      state.dashboardSnapshotIds.push(snapshotId);
      state.dashboardDepth = state.dashboardSnapshotIds.length;
    }
  }

  return state;
}

export function evaluateAutonomyEvidenceThresholds({
  state = {},
  thresholds = {},
} = {}) {
  const blockers = [];
  const minRollbackDrillsPassed = Number(thresholds.minRollbackDrillsPassed ?? 0);
  const maxRegressionCount = Number(thresholds.maxRegressionCount ?? Number.POSITIVE_INFINITY);
  const minDashboardDepth = Number(thresholds.minDashboardDepth ?? 0);

  if (state.rollbackDrills?.passed < minRollbackDrillsPassed) {
    blockers.push('rollback_drills_insufficient');
  }
  if ((state.regressionCount || 0) > maxRegressionCount) {
    blockers.push('regression_count_exceeded');
  }
  if ((state.dashboardDepth || 0) < minDashboardDepth) {
    blockers.push('dashboard_depth_insufficient');
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    thresholds: {
      minRollbackDrillsPassed,
      maxRegressionCount: Number.isFinite(maxRegressionCount) ? maxRegressionCount : null,
      minDashboardDepth,
    },
    state,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
}
