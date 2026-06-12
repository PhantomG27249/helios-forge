import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPABILITY_GOAL_DEFINITIONS,
  summarizeCapabilityGoalStatus,
} from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import { createHarnessStatusSnapshot } from '../src/harness-sidecar/server.js';

test('summarizes paper-alignment capability goals without granting promotion authority', () => {
  const status = summarizeCapabilityGoalStatus({
    signals: [
      {
        goalId: 'benchmark_spine',
        evidence: ['held_out_suite', 'repeated_cycle', 'frontier_trend', 'budget_accounting'],
      },
      {
        goalId: 'rho_at_scale',
        evidence: ['embedding_diversity', 'grouped_reroll'],
      },
      {
        goalId: 'a2a_external_durability',
        evidence: ['endpoint_contract'],
        blockers: ['missing_external_transport'],
      },
    ],
  });

  assert.equal(status.schemaVersion, 1);
  assert.equal(status.authority, 'status_evidence_only');
  assert.equal(status.canPromote, false);
  assert.equal(status.totalCount, CAPABILITY_GOAL_DEFINITIONS.length);
  assert.equal(status.counts.implemented, 1);
  assert.equal(status.counts.partial, 1);
  assert.equal(status.counts.blocked, 1);
  assert.equal(status.openCount, CAPABILITY_GOAL_DEFINITIONS.length - 1);

  const benchmark = status.goals.find((goal) => goal.goalId === 'benchmark_spine');
  const rho = status.goals.find((goal) => goal.goalId === 'rho_at_scale');
  const a2a = status.goals.find((goal) => goal.goalId === 'a2a_external_durability');

  assert.equal(benchmark.status, 'implemented');
  assert.equal(benchmark.canPromote, false);
  assert.equal(benchmark.maturityStage, 'production_gated');
  assert.equal(benchmark.level4ReadyCandidate, false);
  assert.equal(benchmark.level4Proven, false);
  assert.equal(rho.status, 'partial');
  assert.deepEqual(rho.missingEvidence, ['candidate_family_delta', 'self_preference_signal']);
  assert.deepEqual(rho.paperGradeAutonomyGaps, ['model_backed_embedding_scale', 'production_grouped_rerolls']);
  assert.equal(a2a.status, 'blocked');
  assert.deepEqual(a2a.blockers, ['missing_external_transport']);
});

test('requires persisted production evidence before marking benchmark spine level 4 ready', () => {
  const withoutProductionEvidence = summarizeCapabilityGoalStatus({
    signals: [
      {
        goalId: 'benchmark_spine',
        evidence: ['held_out_suite', 'repeated_cycle', 'frontier_trend', 'budget_accounting'],
      },
    ],
  }).goals.find((goal) => goal.goalId === 'benchmark_spine');

  assert.equal(withoutProductionEvidence.status, 'implemented');
  assert.equal(withoutProductionEvidence.maturityStage, 'production_gated');
  assert.deepEqual(withoutProductionEvidence.missingProductionEvidence, [
    'frontier_dashboard_snapshot',
    'operator_dashboard_snapshot',
    'persisted_replay_report',
  ]);
  assert.equal(withoutProductionEvidence.level4ReadyCandidate, false);
  assert.equal(withoutProductionEvidence.level4Proven, false);

  const withProductionEvidence = summarizeCapabilityGoalStatus({
    signals: [
      {
        goalId: 'benchmark_spine',
        evidence: ['held_out_suite', 'repeated_cycle', 'frontier_trend', 'budget_accounting'],
        productionEvidence: [
          'persisted_replay_report',
          'operator_dashboard_snapshot',
          'frontier_dashboard_snapshot',
        ],
      },
    ],
  }).goals.find((goal) => goal.goalId === 'benchmark_spine');

  assert.equal(withProductionEvidence.status, 'implemented');
  assert.equal(withProductionEvidence.maturityStage, 'production_evidence_available');
  assert.deepEqual(withProductionEvidence.missingProductionEvidence, []);
  assert.equal(withProductionEvidence.level4ReadyCandidate, true);
  assert.equal(withProductionEvidence.level4Proven, false);
});

test('keeps future autonomy gaps visible even when substrate evidence is present', () => {
  const status = summarizeCapabilityGoalStatus({
    signals: [
      {
        goalId: 'governance_autonomy',
        evidence: ['autonomy_level', 'approval_policy', 'escalation_policy', 'override_audit', 'rollback_drill'],
        productionEvidence: ['autonomy_dashboard_snapshot', 'rollback_drill_report'],
      },
    ],
  });

  const governance = status.goals.find((goal) => goal.goalId === 'governance_autonomy');
  const soul = status.goals.find((goal) => goal.goalId === 'soul_coverage');

  assert.equal(governance.status, 'implemented');
  assert.equal(governance.maturityStage, 'production_gated');
  assert.equal(governance.productionGate, 'productionAutonomyPolicy');
  assert.deepEqual(governance.paperGradeAutonomyGaps, [
    'human_reviewed_escalation_history',
    'repeated_autonomy_dashboard_evidence',
  ]);
  assert.equal(governance.level4ReadyCandidate, false);
  assert.equal(governance.level4Proven, false);
  assert.equal(soul.maturityStage, 'implemented_substrate');
  assert.equal(soul.level4ReadyCandidate, false);
});

test('harness status snapshot can surface capability goal rows', () => {
  const snapshot = createHarnessStatusSnapshot({
    capabilityGoals: {
      definitions: [
        {
          goalId: 'meta_harness_loop',
          label: 'Meta-Harness loop',
          requiredEvidence: ['isolated_variant', 'metric_artifact'],
          maturityStage: 'production_gated',
          productionGate: 'sourceTreeVariants',
          productionEvidenceRequired: ['persisted_campaign_report'],
          paperGradeAutonomyGaps: ['many_source_variant_campaigns'],
        },
      ],
      signals: [
        {
          goalId: 'meta_harness_loop',
          evidence: ['isolated_variant'],
          productionEvidence: [],
          updatedAt: '2026-06-10T12:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(snapshot.capabilityGoals.totalCount, 1);
  assert.equal(snapshot.capabilityGoals.goals[0].status, 'partial');
  assert.deepEqual(snapshot.capabilityGoals.goals[0].missingEvidence, ['metric_artifact']);
  assert.equal(snapshot.capabilityGoals.goals[0].maturityStage, 'production_gated');
  assert.equal(snapshot.capabilityGoals.goals[0].productionGate, 'sourceTreeVariants');
  assert.deepEqual(snapshot.capabilityGoals.goals[0].missingProductionEvidence, ['persisted_campaign_report']);
  assert.deepEqual(snapshot.capabilityGoals.goals[0].paperGradeAutonomyGaps, ['many_source_variant_campaigns']);
  assert.equal(snapshot.capabilityGoals.goals[0].level4ReadyCandidate, false);
  assert.equal(snapshot.capabilityGoals.goals[0].level4Proven, false);
  assert.equal(snapshot.capabilityGoals.goals[0].updatedAt, '2026-06-10T12:00:00.000Z');
  assert.equal(snapshot.capabilityGoals.canPromote, false);
});
