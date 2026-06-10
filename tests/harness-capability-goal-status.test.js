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
  assert.equal(rho.status, 'partial');
  assert.deepEqual(rho.missingEvidence, ['candidate_family_delta', 'self_preference_signal']);
  assert.equal(a2a.status, 'blocked');
  assert.deepEqual(a2a.blockers, ['missing_external_transport']);
});

test('harness status snapshot can surface capability goal rows', () => {
  const snapshot = createHarnessStatusSnapshot({
    capabilityGoals: {
      definitions: [
        {
          goalId: 'meta_harness_loop',
          label: 'Meta-Harness loop',
          requiredEvidence: ['isolated_variant', 'metric_artifact'],
        },
      ],
      signals: [
        {
          goalId: 'meta_harness_loop',
          evidence: ['isolated_variant'],
          updatedAt: '2026-06-10T12:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(snapshot.capabilityGoals.totalCount, 1);
  assert.equal(snapshot.capabilityGoals.goals[0].status, 'partial');
  assert.deepEqual(snapshot.capabilityGoals.goals[0].missingEvidence, ['metric_artifact']);
  assert.equal(snapshot.capabilityGoals.goals[0].updatedAt, '2026-06-10T12:00:00.000Z');
  assert.equal(snapshot.capabilityGoals.canPromote, false);
});
