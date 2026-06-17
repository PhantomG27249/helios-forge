import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProductionLiveLaneReport,
  fuseLiveBesLane,
} from '../src/harness-sidecar/bes/liveBesFusion.js';

const FUSION_INPUT = {
  lane: 'code',
  taskId: 'task-bes-prod',
  forwardCandidates: [
    { candidateId: 'candidate_a', score: 0.64, compatibleFamily: 'code' },
    { candidateId: 'candidate_b', score: 0.62, compatibleFamily: 'code' },
    { candidateId: 'candidate_c', score: 0.9, compatibleFamily: 'memory' },
  ],
  backwardGoals: [
    { goalId: 'goal_tests', candidateId: 'candidate_b', weight: 0.4, compatibleFamily: 'code' },
    { goalId: 'goal_docs', candidateIds: ['candidate_a'], weight: 0.1, compatibleFamily: 'code' },
  ],
  denseScores: [
    { candidateId: 'candidate_b', score: 0.95, weight: 0.35 },
    { candidateId: 'candidate_a', score: 0.2, weight: 0.35 },
  ],
  adaptiveAction: {
    selectedCandidateId: 'candidate_b',
    action: 'exploit_dense_goal',
    scoreBoost: 0.2,
    trace: { type: 'ab_mcts.action_selected', contextId: 'bes-code' },
  },
  fusionWeights: {
    forward: 0.8,
    backward: 1.2,
    dense: 1,
    adaptive: 0.5,
  },
};

test('buildProductionLiveLaneReport emits live_lane_report evidence envelope', () => {
  const production = buildProductionLiveLaneReport({
    ...FUSION_INPUT,
    gate: { enabled: true, mode: 'advisory', authority: 'evidence_only' },
    now: '2026-06-17T12:00:00.000Z',
  });

  assert.equal(production.evidenceType, 'live_lane_report');
  assert.equal(production.lane, 'code');
  assert.equal(production.taskId, 'task-bes-prod');
  assert.equal(production.generatedAt, '2026-06-17T12:00:00.000Z');
  assert.equal(production.evidenceOnly, true);
  assert.equal(production.promotionEvidenceOnly, true);
  assert.equal(production.canPromote, false);
  assert.equal(production.promotionAllowed, false);
  assert.equal(production.promotionAuthority, false);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.gate.name, 'modelAssistedBesJudgment');
  assert.equal(production.gate.enabled, true);
  assert.equal(production.gate.mode, 'advisory');
  assert.equal(production.gate.authority, 'evidence_only');
  assert.equal(production.fusion.kind, 'live_bes_lane_fusion');
  assert.deepEqual(production.fusion.orderedCandidateIds, ['candidate_b', 'candidate_a', 'candidate_c']);
});

test('buildProductionLiveLaneReport wires fusion metadata for lane ordering', () => {
  const production = buildProductionLiveLaneReport(FUSION_INPUT);
  const ordering = production.laneOrderingEvidence;

  assert.deepEqual(ordering.orderedCandidateIds, ['candidate_b', 'candidate_a', 'candidate_c']);
  assert.deepEqual(ordering.fusionWeights, {
    forward: 0.8,
    backward: 1.2,
    dense: 1,
    adaptive: 0.5,
  });
  assert.equal(ordering.orderingRationale.summary, 'live_bes_forward_backward_fusion');
  assert.equal(ordering.orderingRationale.rankDecisions[0].candidateId, 'candidate_b');
  assert.equal(ordering.orderingRationale.rankDecisions[0].rank, 1);
  assert.equal(ordering.orderingRationale.rankDecisions[0].dominantSignal, 'forward');
  assert.equal(ordering.orderingRationale.rankDecisions[0].weightedContributions.forward, 0.496);
  assert.equal(ordering.orderingRationale.rankDecisions[0].weightedContributions.backward, 0.48);
  assert.equal(ordering.orderingRationale.rankDecisions[1].candidateId, 'candidate_a');
  assert.equal(ordering.orderingRationale.rankDecisions[1].rank, 2);
  assert.equal(typeof ordering.orderingRationale.rankDecisions[0].weightedContributions.forward, 'number');
  assert.equal(typeof ordering.orderingRationale.rankDecisions[0].weightedContributions.backward, 'number');
});

test('buildProductionLiveLaneReport accepts precomputed fusion and defaults gate offline', () => {
  const fusion = fuseLiveBesLane(FUSION_INPUT);
  const production = buildProductionLiveLaneReport({
    fusion,
    lane: 'code',
    taskId: 'task-bes-prod',
  });

  assert.equal(production.gate.enabled, false);
  assert.equal(production.gate.mode, 'offline');
  assert.equal(production.fusion.kind, fusion.kind);
  assert.deepEqual(production.fusion.orderedCandidateIds, fusion.orderedCandidateIds);
  assert.equal(production.fusion.authority, 'evidence_only');
  assert.equal(production.fusion.canPromote, false);
});

test('buildProductionLiveLaneReport forces evidence-only flags on nested fusion output', () => {
  const fusion = fuseLiveBesLane(FUSION_INPUT);
  fusion.canPromote = true;
  fusion.promotionEvidenceOnly = false;
  fusion.authority = 'self_authorized';
  fusion.candidates[0].canPromote = true;
  fusion.candidates[0].authority = 'self_authorized';

  const production = buildProductionLiveLaneReport({
    fusion,
    gate: { enabled: false, mode: 'offline' },
  });

  assert.equal(production.canPromote, false);
  assert.equal(production.promotionEvidenceOnly, true);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.fusion.canPromote, false);
  assert.equal(production.fusion.promotionEvidenceOnly, true);
  assert.equal(production.fusion.authority, 'evidence_only');
  assert.equal(production.fusion.candidates[0].canPromote, false);
  assert.equal(production.fusion.candidates[0].authority, 'evidence_only');
  assert.equal(production.laneOrderingEvidence.canPromote, false);
});
