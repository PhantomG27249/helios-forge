import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { accumulateAutonomyEvidence } from '../src/harness-sidecar/meta/autonomyEvidenceAccumulator.js';
import {
  loadAutonomyProofArtifacts,
  persistAutonomyProofArtifacts,
} from '../src/harness-sidecar/meta/autonomyProofRecorder.js';
import { evaluateProductionAutonomy } from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';

const enabledAutonomyPolicy = {
  productionCapabilities: {
    productionAutonomyPolicy: {
      enabled: true,
      mode: 'advisory',
      authority: 'evidence_only',
    },
  },
  partialAutonomy: {
    thresholds: {
      minRollbackDrillsPassed: 2,
      maxRegressionCount: 0,
      minDashboardDepth: 1,
    },
  },
};

function completeRollbackEvidence() {
  return {
    rollback: {
      reversible: true,
      drillId: 'rollback-1',
      restoreVerified: true,
      artifacts: [{ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:rollback' }],
    },
  };
}

test('persist, reload, and gate L1 production autonomy when evidence depth is insufficient', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-autonomy-proof-'));
  const now = new Date('2026-06-17T12:00:00.000Z');

  try {
    const autonomyState = {
      ...accumulateAutonomyEvidence({
        rollbackDrill: { status: 'passed', drillId: 'rollback-1' },
        replayReport: { reportId: 'replay-1', regressions: [] },
      }),
      drills: [{
        drillId: 'rollback-1',
        status: 'passed',
        restoreVerified: true,
      }],
    };

    const persisted = await persistAutonomyProofArtifacts({
      workspaceRoot,
      autonomyState,
      harnessConfig: enabledAutonomyPolicy,
      now,
    });

    assert.equal(persisted.canPromote, false);
    assert.equal(persisted.evidenceOnly, true);
    assert.equal(persisted.autonomySummary.proofMode, 'full');
    assert.equal(persisted.autonomySummary.productionAutonomyPolicyEnabled, true);
    assert.equal(persisted.autonomySummary.eligible, false);
    assert.equal(persisted.autonomySummary.blockers.includes('rollback_drills_insufficient'), true);
    assert.equal(persisted.autonomySummary.blockers.includes('dashboard_depth_insufficient'), true);

    const summaryRaw = await readFile(
      path.join(workspaceRoot, '.harness', 'governance', 'autonomy-summary.json'),
      'utf8',
    );
    const summary = JSON.parse(summaryRaw);
    assert.equal(summary.canPromote, false);
    assert.equal(summary.thresholdEvaluation?.eligible, false);

    const rollbackRaw = await readFile(
      path.join(workspaceRoot, '.harness', 'governance', 'rollback-drills.json'),
      'utf8',
    );
    const rollback = JSON.parse(rollbackRaw);
    assert.equal(rollback.drills.length, 1);
    assert.equal(rollback.summary.passed, 1);
    assert.equal(rollback.canPromote, false);

    const loaded = await loadAutonomyProofArtifacts(workspaceRoot);
    assert.ok(loaded.autonomyEvidence);
    assert.equal(loaded.autonomyEvidence.rollbackDrills.passed, 1);
    assert.equal(loaded.autonomyEvidence.dashboardDepth, 0);
    assert.equal(loaded.canPromote, false);

    const blocked = evaluateProductionAutonomy({
      candidate: {
        candidateId: 'routing-threshold-blocked',
        candidateType: 'model_routing',
        risk: 'low',
        writeScope: 'workspace_local',
      },
      evidence: completeRollbackEvidence(),
      operatorPolicy: enabledAutonomyPolicy,
      autonomyEvidence: loaded.autonomyEvidence,
    });

    assert.equal(blocked.maxAutonomyLevel, 1);
    assert.equal(blocked.promotionEligible, false);
    assert.equal(blocked.canPromote, false);
    assert.equal(blocked.blockers.includes('rollback_drills_insufficient'), true);
    assert.equal(blocked.blockers.includes('dashboard_depth_insufficient'), true);
    assert.equal(blocked.autonomyEvidencePolicy?.eligible, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('basic persistence is allowed when production autonomy policy is disabled', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-autonomy-proof-basic-'));
  const now = new Date('2026-06-17T12:00:00.000Z');

  try {
    const autonomyState = accumulateAutonomyEvidence({
      rollbackDrill: { status: 'passed' },
      replayReport: { reportId: 'replay-basic', regressions: [{ caseId: 'c1' }] },
    });

    const persisted = await persistAutonomyProofArtifacts({
      workspaceRoot,
      autonomyState,
      harnessConfig: {
        productionCapabilities: {
          productionAutonomyPolicy: { enabled: false },
        },
      },
      now,
    });

    assert.equal(persisted.autonomySummary.proofMode, 'basic');
    assert.equal(persisted.autonomySummary.productionAutonomyPolicyEnabled, false);
    assert.equal(persisted.autonomySummary.thresholdEvaluation, undefined);
    assert.equal(persisted.autonomySummary.eligible, undefined);
    assert.equal(persisted.autonomySummary.regressionCount, 1);

    const loaded = await loadAutonomyProofArtifacts(workspaceRoot);
    assert.equal(loaded.autonomyEvidence.regressionCount, 1);
    assert.equal(loaded.autonomyEvidence.rollbackDrills.passed, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
