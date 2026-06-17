import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { summarizeCapabilityGoalStatus } from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import {
  persistIcrCandidateFamily,
  persistIcrRhoReport,
} from '../src/harness-sidecar/icr/icrEvidenceStore.js';
import {
  buildIcrEvidenceStatus,
  buildIcrHarnessCapabilityInputs,
} from '../src/harness-sidecar/icr/icrStatusHandler.js';

function sampleFamily() {
  return {
    kind: 'icr_candidate_family',
    lane: 'icr',
    taskId: 'task-status-1',
    candidateFamilyId: 'family-status-1',
    createdAt: '2026-06-17T12:00:00.000Z',
    branchTraces: [{
      kind: 'icr_branch_trace',
      branchId: 'icr_branch_001',
      branchMemory: [{ secret: 'hidden branch memory' }],
      critiqueRecords: [{ critique: 'hidden critique' }],
      evidenceOnly: true,
      promotionAllowed: false,
    }],
    finalJudgePacket: {
      kind: 'icr_blind_final_judge_packet',
      candidates: [{ candidateId: 'icr_candidate_001', branchId: 'icr_branch_001' }],
    },
    finalCandidateId: 'icr_candidate_001',
    contextTokenEstimate: 220,
    config: {
      maxContextTokens: 200,
      maxComputeMultiplier: 0.5,
    },
    evidenceOnly: true,
    promotionAllowed: false,
  };
}

test('buildIcrEvidenceStatus returns empty gated response when store is empty', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-status-empty-'));
  try {
    const status = await buildIcrEvidenceStatus({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          icrLane: { enabled: true, mode: 'offline' },
        },
      },
    });

    assert.equal(status.type, 'icrStatus');
    assert.equal(status.evidenceOnly, true);
    assert.equal(status.canPromote, false);
    assert.deepEqual(status.gate, {
      name: 'icrLane',
      enabled: true,
      mode: 'offline',
      authority: 'evidence_only',
    });
    assert.deepEqual(status.summary, {
      itemCount: 0,
      available: false,
      latestTaskId: null,
      costGateStatus: null,
      rhoRegressionCount: 0,
    });
    assert.deepEqual(status.items, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('buildIcrEvidenceStatus hides items when icrLane gate is disabled', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-status-gate-'));
  try {
    await persistIcrCandidateFamily(workspaceRoot, sampleFamily());

    const status = await buildIcrEvidenceStatus({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          icrLane: { enabled: false, mode: 'offline' },
        },
      },
    });

    assert.equal(status.gate.enabled, false);
    assert.equal(status.summary.itemCount, 0);
    assert.deepEqual(status.items, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('buildIcrEvidenceStatus returns sanitized populated evidence', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-status-pop-'));
  try {
    await persistIcrCandidateFamily(workspaceRoot, sampleFamily());
    await persistIcrRhoReport(workspaceRoot, {
      kind: 'icr_rho_replay_comparison',
      taskId: 'task-status-1',
      comparisonId: 'rho-status-1',
      regressions: [{ baseline: 'repeated_sampling_baseline' }],
      upliftMetrics: {
        icr_branch_family: { beatsBestSingle: false, scoreDelta: -0.1, cheaperBaselineLosses: ['repeated_sampling_baseline'] },
      },
      promotionAllowed: true,
    });

    const status = await buildIcrEvidenceStatus({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          icrLane: { enabled: true, mode: 'offline' },
        },
        icr: { enabled: true },
      },
    });

    assert.equal(status.summary.itemCount, 2);
    assert.equal(status.summary.available, true);
    assert.equal(status.summary.latestTaskId, 'task-status-1');
    assert.equal(status.summary.costGateStatus, 'exceeded');
    assert.equal(status.summary.rhoRegressionCount, 1);
    assert.equal(status.items[0].kind, 'icr_dashboard_evidence_summary');
    assert.equal(status.items[0].promotionAllowed, false);

    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes('hidden branch memory'), false);
    assert.equal(serialized.includes('hidden critique'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('buildIcrHarnessCapabilityInputs feeds summarizeCapabilityGoalStatus', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-status-cap-'));
  try {
    await persistIcrCandidateFamily(workspaceRoot, sampleFamily());

    const inputs = await buildIcrHarnessCapabilityInputs({
      workspaceRoot,
      harnessConfig: { icr: { enabled: true, maxContextTokens: 200, maxComputeMultiplier: 10 } },
    });

    assert.equal(inputs.icrConfig.evidenceOnly, true);
    assert.equal(inputs.icrConfig.promotionAllowed, false);
    assert.equal(inputs.icrEvidence.length, 1);

    const status = summarizeCapabilityGoalStatus(inputs);
    const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
    assert.ok(goal);
    assert.equal(goal.canPromote, false);
    assert.equal(status.icrDashboardRows[0].promotionAllowed, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
