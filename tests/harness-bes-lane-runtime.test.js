import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeLaneEvidence } from '../src/harness-sidecar/bes/laneEvidence.js';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';

test('wraps a shadow candidate in a BES lane envelope', async () => {
  const result = await runBesLaneRuntime({
    lane: 'memory',
    taskId: 'task-memory-1',
    candidates: [
      {
        candidateId: 'memory_policy_1',
        status: 'shadow_only',
        rationale: ['pending_activation_stall'],
      },
    ],
    hardCases: [
      { caseId: 'case-1', reasons: ['memgraph_pending_activation_stall'] },
    ],
    denseSubgoals: [
      { id: 'activation_stall', requiredEvidence: 'schema threshold' },
    ],
    evaluator: ({ candidate }) => ({
      score: 0.7,
      reasons: ['schema threshold addresses activation stall'],
      safetyStatus: candidate.status,
    }),
  });

  assert.equal(result.lane, 'memory');
  assert.equal(result.taskId, 'task-memory-1');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].promotion.blockedReasons.includes('evidence_only_lane'));
  assert.equal(result.candidates[0].bes.denseSubgoals.score, 1);
  assert.equal(result.candidates[0].evidence.domain.score, 0.7);
  assert.equal(result.candidates[0].lineage.candidateId, 'memory_policy_1');
});

test('blocks candidates that claim durable approval or application', async () => {
  const result = await runBesLaneRuntime({
    lane: 'skill',
    taskId: 'task-skill-1',
    candidates: [
      {
        candidateId: 'skill_bad',
        status: 'approved',
        applied: true,
        durableApplyApproved: true,
        promotion: { allowed: true },
      },
    ],
    evaluator: () => ({ score: 1, reasons: ['looks useful'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.promotion.allowed, false);
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_approval'));
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_applied'));
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_promotion'));
});

test('preserves A2A and memory graph references without granting promotion authority', async () => {
  const result = await runBesLaneRuntime({
    lane: 'research',
    taskId: 'task-nested-mesh',
    a2aEnvelope: {
      payload: {
        candidateRef: 'candidate-1',
        rhoCaseIds: ['rho-case-1'],
        memoryGraphRefs: ['memory-fact-1'],
        lineage: { parents: ['agent-1', 'agent-2'] },
        trust: { external: false, verified: false },
        requiredVerification: ['citation_audit'],
      },
    },
    memoryGraphContext: {
      local: { nodeIds: ['local-hard-case-1'] },
      swarmCell: { nodeIds: ['cell-lesson-1'] },
      global: { nodeIds: ['global-pattern-1'], provenance: ['trace-1'] },
      conflicts: [{ id: 'conflict-1', status: 'needs_review' }],
    },
    candidates: [{ candidateId: 'candidate-1', status: 'shadow_only' }],
    hardCases: [{ caseId: 'rho-case-1', reasons: ['citation_gap'] }],
    evaluator: () => ({
      score: 0.75,
      reasons: ['citation gap addressed'],
      safetyStatus: 'shadow_only',
    }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.promotion.allowed, false);
  assert.equal(candidate.a2a.payload.candidateRef, 'candidate-1');
  assert.deepEqual(candidate.memoryGraph.global.nodeIds, ['global-pattern-1']);
  assert.deepEqual(candidate.memoryGraph.conflicts[0].id, 'conflict-1');
  assert.ok(candidate.lineage.lineageId.includes('candidate-1'));
});

test('failed RHO validation is visible and blocks promotion', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-rho-1',
    candidates: [{ candidateId: 'candidate-regression', status: 'shadow_only' }],
    replayRunner: async () => ({
      validation: { passed: false, reasons: ['regression_detected'] },
      preference: { winner: 'candidate' },
    }),
    evaluator: () => ({ score: 0.9, reasons: ['candidate preferred'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.rho.validation.passed, false);
  assert.ok(candidate.promotion.blockedReasons.includes('rho_validation_failed'));
  assert.equal(candidate.promotion.allowed, false);
});

test('empty dense subgoal shells do not satisfy required evidence', async () => {
  const result = await runBesLaneRuntime({
    lane: 'harness',
    taskId: 'task-no-evidence',
    candidates: [{ candidateId: 'harness-candidate', status: 'shadow_only' }],
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.hasRequiredEvidence, false);
  assert.deepEqual(candidate.evidence.sources, []);
  assert.ok(candidate.promotion.blockedReasons.includes('missing_required_evidence'));
});

test('normalizes lane evidence sources and required evidence summary', () => {
  const evidence = normalizeLaneEvidence({
    domain: { score: 0.5 },
    rho: { validation: { passed: true } },
    denseSubgoals: { score: 1, total: 1, satisfiedSubgoalIds: ['goal'] },
  });

  assert.deepEqual(evidence.sources.sort(), ['dense_subgoals', 'domain_eval', 'rho_replay']);
  assert.equal(evidence.hasRequiredEvidence, true);
});
