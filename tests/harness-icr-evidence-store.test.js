import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { summarizeCapabilityGoalStatus } from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import {
  icrStorePaths,
  loadIcrEvidenceForCapabilityGoals,
  loadRecentIcrEvidence,
  persistIcrCandidateFamily,
  persistIcrRhoReport,
} from '../src/harness-sidecar/icr/icrEvidenceStore.js';

function sampleFamily(overrides = {}) {
  return {
    kind: 'icr_candidate_family',
    lane: 'icr',
    taskId: 'task-store-1',
    candidateFamilyId: 'family-store-1',
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
    evidenceOnly: true,
    promotionAllowed: false,
    apiKey: 'sk-store-secret',
    ...overrides,
  };
}

test('icrStorePaths stay inside the workspace root', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-store-'));
  try {
    const paths = icrStorePaths(workspaceRoot);
    const resolvedRoot = path.resolve(workspaceRoot);
    for (const target of Object.values(paths)) {
      const relative = path.relative(resolvedRoot, target);
      assert.equal(relative.startsWith('..'), false);
      assert.equal(path.isAbsolute(relative), false);
    }
    assert.match(paths.familiesDir, /[\\/]\.harness[\\/]icr[\\/]families$/);
    assert.match(paths.rhoReportsDir, /[\\/]\.harness[\\/]icr[\\/]rho-reports$/);
    assert.match(paths.latestIndex, /[\\/]\.harness[\\/]icr[\\/]latest-index\.json$/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('persist and load round-trip ICR families and rho reports with evidence-only enforcement', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-store-'));
  try {
    const family = sampleFamily();
    const rhoReport = {
      kind: 'icr_rho_replay_comparison',
      taskId: 'task-store-1',
      comparisonId: 'rho-store-1',
      createdAt: '2026-06-17T12:05:00.000Z',
      upliftMetrics: {
        icr_branch_family: { beatsBestSingle: true, scoreDelta: 0.2, cheaperBaselineLosses: [] },
      },
      regressions: [],
      promotionAllowed: true,
      canPromote: true,
    };

    await persistIcrCandidateFamily(workspaceRoot, family);
    await persistIcrRhoReport(workspaceRoot, rhoReport);

    const loaded = await loadRecentIcrEvidence(workspaceRoot);
    assert.equal(loaded.families.length, 1);
    assert.equal(loaded.rhoReports.length, 1);
    assert.equal(loaded.families[0].evidenceOnly, true);
    assert.equal(loaded.families[0].promotionAllowed, false);
    assert.equal(loaded.families[0].canPromote, false);
    assert.equal(loaded.rhoReports[0].promotionAllowed, false);
    assert.equal(loaded.families[0].branchMemory, undefined);
    assert.equal(loaded.families[0].branchTraces[0].branchMemory, undefined);
    assert.equal(loaded.families[0].apiKey, '[redacted]');

    const indexRaw = await readFile(icrStorePaths(workspaceRoot).latestIndex, 'utf8');
    const index = JSON.parse(indexRaw);
    assert.equal(index.evidenceOnly, true);
    assert.equal(index.promotionAllowed, false);
    assert.equal(index.entries[0].taskId, 'task-store-1');
    assert.match(index.entries[0].familyPath, /^\.harness\/icr\/families\//);
    assert.match(index.entries[0].rhoReportPath, /^\.harness\/icr\/rho-reports\//);
    assert.equal(index.entries[0].promotionAllowed, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadRecentIcrEvidence returns empty arrays when store is missing', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-store-empty-'));
  try {
    const loaded = await loadRecentIcrEvidence(workspaceRoot);
    assert.deepEqual(loaded, { families: [], rhoReports: [] });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadIcrEvidenceForCapabilityGoals merges rho reports for capability goal status', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-store-cap-'));
  try {
    await persistIcrCandidateFamily(workspaceRoot, sampleFamily({
      contextTokenEstimate: 120,
      config: { maxContextTokens: 200, maxComputeMultiplier: 10 },
    }));
    await persistIcrRhoReport(workspaceRoot, {
      kind: 'icr_rho_replay_comparison',
      taskId: 'task-store-1',
      comparisonId: 'rho-store-1',
      upliftMetrics: {
        repeated_sampling_baseline: { beatsBestSingle: true, scoreDelta: 0.1, cheaperBaselineLosses: [] },
        static_council_baseline: { beatsBestSingle: true, scoreDelta: 0.1, cheaperBaselineLosses: [] },
        icr_branch_family: { beatsBestSingle: true, scoreDelta: 0.2, cheaperBaselineLosses: [] },
        icr_bes_lane_fusion: { beatsBestSingle: true, scoreDelta: 0.3, cheaperBaselineLosses: [] },
      },
      regressions: [],
    });

    const icrEvidence = await loadIcrEvidenceForCapabilityGoals(workspaceRoot, {
      maxContextTokens: 200,
      maxComputeMultiplier: 10,
    });
    assert.equal(icrEvidence.length, 1);
    assert.equal(icrEvidence[0].rhoReplayComparison.taskId, 'task-store-1');

    const status = summarizeCapabilityGoalStatus({ icrEvidence });
    const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
    assert.ok(goal);
    assert.equal(goal.canPromote, false);
    assert.equal(status.icrDashboardRows.length, 1);
    assert.equal(status.icrDashboardRows[0].promotionAllowed, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('persist keeps artifact paths inside the workspace root', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-store-boundary-'));
  try {
    const { filePath } = await persistIcrCandidateFamily(workspaceRoot, sampleFamily({
      taskId: '../../../outside',
      candidateFamilyId: '../../escape',
    }));
    const resolvedRoot = path.resolve(workspaceRoot);
    const relative = path.relative(resolvedRoot, filePath);
    assert.equal(relative.startsWith('..'), false);
    assert.match(relative, /^\.harness[\\/]icr[\\/]families[\\/]/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
