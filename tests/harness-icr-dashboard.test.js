import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPABILITY_GOAL_DEFINITIONS,
  summarizeCapabilityGoalStatus,
} from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import { createHarnessStatusSnapshot } from '../src/harness-sidecar/server.js';

function icrRecord(overrides = {}) {
  return {
    kind: 'icr_candidate_family',
    lane: 'icr',
    taskId: 'task-icr-dashboard',
    candidateFamilyId: 'family-dashboard-1',
    branches: [
      {
        kind: 'icr_branch_trace',
        branchId: 'branch-dashboard-a',
        iterations: [
          {
            candidateId: 'cand-dashboard-a',
            candidateText: 'secret raw candidate token=sk-dashboard from C:\\Users\\jackj\\private.md',
            critiqueSummary: 'hidden critique must stay out of status',
          },
        ],
        branchMemory: [{ text: 'hidden branch memory must stay out' }],
        critiqueRecords: [{ text: 'hidden critique record must stay out' }],
        pqfRecords: [{ pqfId: 'pqf-dashboard-1', kept: true }],
        evidenceOnly: true,
        promotionAllowed: false,
      },
    ],
    finalJudgePacket: {
      kind: 'icr_blind_final_judge_packet',
      candidates: [{ candidateId: 'cand-dashboard-a', branchId: 'branch-dashboard-a', text: 'visible final candidate' }],
      hiddenFromJudge: [
        'branch_memory',
        'critique_records',
        'pqf_records',
        'replaced_branches',
        'hypothesis_history',
      ],
    },
    finalCandidateId: 'cand-dashboard-a',
    contextTokenEstimate: 220,
    config: {
      maxContextTokens: 200,
      maxComputeMultiplier: 0.5,
    },
    evidenceOnly: true,
    promotionAllowed: false,
    ...overrides,
  };
}

test('harness status snapshot exposes dashboard-safe ICR capability goal rows and blockers', () => {
  const snapshot = createHarnessStatusSnapshot({
    capabilityGoals: {
      icrEvidence: [icrRecord({
        rhoUpliftReport: null,
      })],
    },
  });

  const goal = snapshot.capabilityGoals.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.ok(goal);
  assert.equal(goal.status, 'blocked');
  assert.equal(goal.canPromote, false);
  assert.equal(goal.level4ReadyCandidate, false);
  assert.deepEqual(goal.blockers, [
    'icr_context_overflow_risk',
    'icr_cost_gate_unproven',
    'icr_production_replay_missing',
    'missing_icr_rho_uplift_report',
  ]);
  assert.deepEqual(goal.missingEvidence, [
    'icr_bes_lane_evidence',
    'icr_cost_gate',
    'icr_production_replay',
    'icr_rho_uplift_report',
  ]);
  assert.equal(snapshot.capabilityGoals.icrDashboardRows.length, 1);
  assert.equal(snapshot.capabilityGoals.icrDashboardRows[0].kind, 'icr_dashboard_evidence_summary');
  assert.equal(snapshot.capabilityGoals.icrDashboardRows[0].promotionAllowed, false);

  const serialized = JSON.stringify(snapshot.capabilityGoals);
  assert.equal(serialized.includes('sk-dashboard'), false);
  assert.equal(serialized.includes('C:\\Users\\jackj'), false);
  assert.equal(serialized.includes('hidden critique'), false);
  assert.equal(serialized.includes('hidden branch memory'), false);
});

test('ICR capability goal does not become level four ready without persisted production replay evidence', () => {
  const status = summarizeCapabilityGoalStatus({
    icrEvidence: [icrRecord({
      besLaneEvidence: { lane: 'icr', evidenceOnly: true },
      rhoUpliftReport: { comparisonId: 'rho-icr-1', upliftOverBaselines: true },
      contextTokenEstimate: 120,
      config: {
        maxContextTokens: 200,
        maxComputeMultiplier: 10,
      },
    })],
  });

  const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.equal(goal.status, 'blocked');
  assert.equal(goal.level4ReadyCandidate, false);
  assert.deepEqual(goal.blockers, [
    'icr_production_replay_missing',
    'missing_icr_rho_uplift_report',
  ]);
  assert.deepEqual(goal.missingEvidence, [
    'icr_production_replay',
    'icr_rho_uplift_report',
  ]);
});

test('ICR capability goal reports missing branch traces and blind judge evidence as blockers', () => {
  const status = summarizeCapabilityGoalStatus({
    icrEvidence: [{
      kind: 'icr_candidate_family',
      lane: 'icr',
      taskId: 'task-icr-missing-evidence',
      contextTokenEstimate: 1,
      config: {
        maxContextTokens: 200,
        maxComputeMultiplier: 10,
      },
      evidenceOnly: true,
      promotionAllowed: false,
    }],
  });

  const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.equal(goal.blockers.includes('missing_icr_branch_trace_evidence'), true);
  assert.equal(goal.blockers.includes('missing_icr_blind_judge_evidence'), true);
});

test('ICR capability goal is ordered into the existing dashboard row window', () => {
  const firstDashboardWindow = CAPABILITY_GOAL_DEFINITIONS.slice(0, 8).map((goal) => goal.goalId);
  assert.equal(firstDashboardWindow.includes('icr_test_time_compute'), true);
});

test('ICR level four readiness ignores explicit claims without persisted production evidence', () => {
  const status = summarizeCapabilityGoalStatus({
    signals: [{
      goalId: 'icr_test_time_compute',
      evidence: [
        'icr_branch_trace_evidence',
        'icr_blind_judge_evidence',
        'icr_bes_lane_evidence',
        'icr_cost_gate',
        'icr_production_replay',
        'icr_rho_uplift_report',
        'icr_dashboard_snapshot',
      ],
      level4ReadyCandidate: true,
    }],
  });

  const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.equal(goal.status, 'implemented');
  assert.equal(goal.level4ReadyCandidate, false);
});

test('ICR maturity stays blocked when RHO uplift evidence reports regressions', () => {
  const status = summarizeCapabilityGoalStatus({
    icrEvidence: [icrRecord({
      besLaneEvidence: { lane: 'icr', evidenceOnly: true },
      rhoUpliftReport: {
        upliftOverBaselines: false,
        regressions: [{ baseline: 'repeated_sampling_baseline' }],
      },
      productionReplay: { persisted: true },
      contextTokenEstimate: 120,
      config: {
        maxContextTokens: 200,
        maxComputeMultiplier: 10,
      },
    })],
  });

  const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.equal(goal.level4ReadyCandidate, false);
  assert.equal(goal.blockers.includes('missing_icr_rho_uplift_report'), true);
  assert.equal(goal.blockers.includes('icr_rho_regression_detected'), true);
  assert.equal(goal.missingEvidence.includes('icr_rho_uplift_report'), true);
});

test('ICR readiness requires complete RHO proof across branch family and BES fusion baselines', () => {
  const status = summarizeCapabilityGoalStatus({
    icrEvidence: [icrRecord({
      besLaneEvidence: { lane: 'icr', evidenceOnly: true },
      rhoUpliftReport: {
        upliftMetrics: {
          icr_branch_family: {
            beatsBestSingle: true,
            scoreDelta: 0.4,
            cheaperBaselineLosses: [],
          },
        },
        regressions: [],
      },
      productionReplay: { persisted: true },
      contextTokenEstimate: 120,
      config: {
        maxContextTokens: 200,
        maxComputeMultiplier: 10,
      },
    })],
  });

  const goal = status.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
  assert.equal(goal.status, 'blocked');
  assert.equal(goal.level4ReadyCandidate, false);
  assert.equal(goal.blockers.includes('missing_icr_rho_uplift_report'), true);
  assert.equal(goal.missingEvidence.includes('icr_rho_uplift_report'), true);
});
