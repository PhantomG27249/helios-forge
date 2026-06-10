import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decideGovernanceAction,
  listAutonomyLevels,
  planScheduledReplayJobs,
  recordRollbackDrill,
  summarizeGovernanceStatus,
} from '../src/harness-sidecar/meta/governanceLoop.js';
import { createHarnessStatusSnapshot } from '../src/harness-sidecar/server.js';

test('plans due replay jobs and blocks jobs that would exceed improvement budget', () => {
  const result = planScheduledReplayJobs({
    now: '2026-06-09T20:00:00.000Z',
    budget: { remainingUsd: 1.2 },
    definitions: [
      {
        replayId: 'rho-nightly',
        kind: 'rho_replay_batch',
        cadence: 'nightly',
        nextRunAt: '2026-06-09T19:59:00.000Z',
        estimatedCostUsd: 0.5,
        coresetId: 'frontier-hard-cases',
      },
      {
        replayId: 'budget-drill',
        kind: 'budget_policy_replay',
        nextRunAt: '2026-06-09T20:00:00.000Z',
        estimatedCostUsd: 0.9,
      },
      {
        replayId: 'later',
        kind: 'rho_replay_batch',
        nextRunAt: '2026-06-10T02:00:00.000Z',
        estimatedCostUsd: 0.1,
      },
    ],
  });

  assert.deepEqual(result.jobs.map((job) => job.jobId), [
    'replay_rho-nightly_20260609t200000000z',
    'replay_budget-drill_20260609t200000000z',
  ]);
  assert.equal(result.jobs[0].status, 'queued');
  assert.equal(result.jobs[0].coresetId, 'frontier-hard-cases');
  assert.equal(result.jobs[1].status, 'blocked');
  assert.deepEqual(result.jobs[1].blockedReasons, ['improvement_budget_exceeded']);
  assert.equal(result.accounting.spentUsd, 0.5);
  assert.equal(result.accounting.remainingUsd, 0.7);
  assert.equal(result.nextPendingAt, '2026-06-10T02:00:00.000Z');
});

test('summarizes frontier, rollback drills, replay jobs, and budget-aware accounting', () => {
  const rollback = recordRollbackDrill({
    drillId: 'drill-local-config',
    candidateId: 'candidate-a',
    startedAt: '2026-06-09T20:01:00.000Z',
    completedAt: '2026-06-09T20:02:00.000Z',
    restoreVerified: true,
    artifacts: ['rollback.patch', 'post-rollback-eval.json'],
  });

  const summary = summarizeGovernanceStatus({
    replayJobs: [
      { jobId: 'replay-a', status: 'queued', kind: 'rho_replay_batch' },
      { jobId: 'replay-b', status: 'blocked', blockedReasons: ['improvement_budget_exceeded'] },
    ],
    frontier: [
      { candidateId: 'candidate-a', metrics: { quality: 0.8, safety: 0.95, cost: 0.2, latency: 20 } },
      { candidateId: 'candidate-b', metrics: { quality: 0.7, safety: 0.9, cost: 0.6, latency: 40 } },
    ],
    rollbackDrills: [rollback],
    improvementAccounting: { spentUsd: 0.5, remainingUsd: 0.7, blockedJobCount: 1 },
  });

  assert.equal(rollback.status, 'passed');
  assert.equal(rollback.reversible, true);
  assert.equal(summary.replayJobs.queuedCount, 1);
  assert.equal(summary.replayJobs.blockedCount, 1);
  assert.equal(summary.frontier.candidateCount, 2);
  assert.equal(summary.frontier.bestCandidateId, 'candidate-a');
  assert.equal(summary.rollbackDrills.lastStatus, 'passed');
  assert.equal(summary.improvementAccounting.blockedJobCount, 1);
});

test('applies autonomy levels, low-risk reversible approval policy, and escalation audit records', () => {
  const auto = decideGovernanceAction({
    autonomyLevel: 2,
    candidate: {
      candidateId: 'local-config-a',
      changeType: 'local_config',
      risk: 'low',
      costIncrease: 0,
    },
    evidence: { baselinePassed: true, heldOutPassed: true },
    rollback: { reversible: true },
    actor: 'meta-loop',
  });

  const escalated = decideGovernanceAction({
    autonomyLevel: 2,
    candidate: {
      candidateId: 'branch-mutation-a',
      changeType: 'branch_mutation',
      risk: 'high',
    },
    evidence: { baselinePassed: true, heldOutPassed: true },
    rollback: { reversible: true },
    actor: 'meta-loop',
  });

  const override = decideGovernanceAction({
    autonomyLevel: 0,
    candidate: { candidateId: 'override-a', changeType: 'local_config', risk: 'low' },
    evidence: { baselinePassed: true, heldOutPassed: true },
    rollback: { reversible: true },
    override: { approvedBy: 'operator', reason: 'manual drill' },
    actor: 'operator',
  });

  assert.equal(auto.decision, 'auto_approved');
  assert.equal(auto.autonomy.levelName, 'supervised');
  assert.deepEqual(auto.auditEvent.reasons, ['held_out_passed', 'baseline_passed', 'rollback_available']);
  assert.equal(escalated.decision, 'escalated');
  assert.equal(escalated.auditEvent.type, 'governance.escalation');
  assert.deepEqual(escalated.auditEvent.reasons, ['branch_mutation_requires_human']);
  assert.equal(override.decision, 'override_approved');
  assert.equal(override.auditEvent.type, 'governance.override');
});

test('formal autonomy levels narrow auto approval to reversible local config and summarize escalation reasons', () => {
  const levels = listAutonomyLevels();
  assert.deepEqual(levels.map((level) => level.levelName), ['manual', 'shadow', 'supervised', 'guarded']);
  assert.equal(levels[2].allowedActions.includes('apply_local_reversible'), false);
  assert.equal(levels[3].allowedActions.includes('apply_local_reversible'), true);

  const denied = decideGovernanceAction({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'global-config-a',
      changeType: 'local_config',
      risk: 'low',
      writeScope: 'global',
    },
    evidence: { baselinePassed: true, heldOutPassed: true },
    rollback: { reversible: true },
    actor: 'meta-loop',
  });

  assert.equal(denied.decision, 'escalated');
  assert.equal(denied.reasons.includes('auto_approval_limited_to_local_reversible_scope'), true);

  const summary = summarizeGovernanceStatus({
    autonomyLevel: 3,
    auditEvents: [denied.auditEvent],
  });
  assert.equal(summary.autonomy.levelName, 'guarded');
  assert.equal(summary.audit.escalationCount, 1);
  assert.deepEqual(summary.audit.escalationReasons, ['auto_approval_limited_to_local_reversible_scope']);
  assert.equal(summary.audit.lastEscalation.candidateId, 'global-config-a');
});

test('harness status snapshot includes governance dashboard summaries', () => {
  const snapshot = createHarnessStatusSnapshot({
    governance: {
      replayJobs: [{ jobId: 'replay-a', status: 'queued' }],
      frontier: [{ candidateId: 'candidate-a', metrics: { quality: 0.8, safety: 0.9, cost: 0.2, latency: 10 } }],
      rollbackDrills: [{ drillId: 'drill-a', status: 'passed', reversible: true }],
      improvementAccounting: { spentUsd: 0.25, remainingUsd: 0.75 },
      auditEvents: [{ type: 'governance.escalation' }, { type: 'governance.override' }],
    },
  });

  assert.equal(snapshot.governance.replayJobs.queuedCount, 1);
  assert.equal(snapshot.governance.frontier.bestCandidateId, 'candidate-a');
  assert.equal(snapshot.governance.rollbackDrills.passedCount, 1);
  assert.equal(snapshot.governance.audit.escalationCount, 1);
  assert.equal(snapshot.governance.audit.overrideCount, 1);
});

test('governance status exposes longitudinal frontier dashboard rows without promotion authority', () => {
  const summary = summarizeGovernanceStatus({
    longitudinalFrontier: {
      suites: [{ suiteId: 'stable-holdout', cases: [{ caseId: 'case-a' }] }],
      cycles: [
        {
          cycleId: 'cycle-001',
          suiteId: 'stable-holdout',
          recordedAt: '2026-06-09T20:00:00.000Z',
          accounting: { spentUsd: 0.4, remainingUsd: 1.6, entryCount: 1, caseCount: 1 },
          entries: [
            {
              candidateId: 'candidate-a',
              suiteId: 'stable-holdout',
              cycleId: 'cycle-001',
              recordedAt: '2026-06-09T20:00:00.000Z',
              canPromote: true,
              metrics: {
                quality: 0.7,
                safety: 0.9,
                reliability: 0.8,
                cost: 0.3,
                latency: 11,
                maintainability: 0.7,
                visualConfidence: 0.6,
                memoryHealth: 0.8,
                trustRisk: 0.2,
              },
            },
          ],
        },
      ],
      frontier: [{ candidateId: 'candidate-a', metrics: { quality: 0.7, safety: 0.9, cost: 0.3, latency: 11 } }],
    },
  });

  assert.equal(summary.longitudinalFrontier.cycleCount, 1);
  assert.equal(summary.longitudinalFrontier.dashboardRows.length, 1);
  assert.equal(summary.longitudinalFrontier.dashboardRows[0].suiteId, 'stable-holdout');
  assert.equal(summary.longitudinalFrontier.dashboardRows[0].classification, 'new');
  assert.equal(summary.longitudinalFrontier.dashboardRows[0].canPromote, false);
  assert.equal(summary.longitudinalFrontier.accounting.spentUsd, 0.4);
});
