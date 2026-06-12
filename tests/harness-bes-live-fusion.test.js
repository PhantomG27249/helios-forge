import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fuseLiveBesLane } from '../src/harness-sidecar/bes/liveBesFusion.js';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';

test('live BES fusion orders forward candidates with backward goals dense scores and adaptive action', () => {
  const result = fuseLiveBesLane({
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
    trajectoryOperators: [
      { candidateId: 'candidate_b', operator: 'crossover', parents: ['seed_a', 'seed_b'], compatibleFamily: 'code' },
    ],
  });

  assert.equal(result.evidenceOnly, true);
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.promotionAuthority, false);
  assert.deepEqual(result.orderedCandidateIds, ['candidate_b', 'candidate_a', 'candidate_c']);
  assert.equal(result.candidates[0].candidateId, 'candidate_b');
  assert.equal(result.candidates[0].scoreBreakdown.forwardScore, 0.62);
  assert.equal(result.candidates[0].scoreBreakdown.backwardGoalScore, 0.4);
  assert.equal(result.candidates[0].scoreBreakdown.denseScore, 0.3325);
  assert.equal(result.candidates[0].scoreBreakdown.adaptiveBoost, 0.2);
  assert.deepEqual(result.candidates[0].matchedBackwardGoalIds, ['goal_tests']);
  assert.deepEqual(result.candidates[0].trajectoryOperators[0].parents, ['seed_a', 'seed_b']);
  assert.deepEqual(result.compatibleFamilies, ['code', 'memory']);
});

test('live BES fusion preserves trajectory provenance and evidence-only metadata', () => {
  const result = fuseLiveBesLane({
    forwardCandidates: [{ candidateId: 'candidate_seed', score: 0.5, family: 'visual' }],
    trajectoryOperators: [
      {
        candidateId: 'candidate_seed',
        operator: 'mutation',
        operatorFamily: 'mutation',
        inputTrajectoryId: 'traj_in',
        outputTrajectoryId: 'traj_out',
        compatibleFamily: 'visual',
      },
    ],
  });

  assert.equal(result.kind, 'live_bes_lane_fusion');
  assert.equal(result.candidates[0].trajectoryOperators[0].inputTrajectoryId, 'traj_in');
  assert.equal(result.candidates[0].trajectoryOperators[0].outputTrajectoryId, 'traj_out');
  assert.equal(result.candidates[0].compatibleFamily, 'visual');
  assert.equal(result.candidates[0].canPromote, false);
  assert.equal(result.candidates[0].authority, 'evidence_only');
});

test('BES lane runtime wires live fusion while preserving lane output authority', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-live-fusion',
    candidates: [
      { candidateId: 'candidate_a', status: 'shadow_only', evidence: ['tests'] },
      { candidateId: 'candidate_b', status: 'shadow_only', evidence: ['tests'] },
    ],
    backwardGoals: [
      { goalId: 'goal_patch', candidateId: 'candidate_b', weight: 0.5, compatibleFamily: 'code' },
    ],
    denseScores: [
      { candidateId: 'candidate_a', score: 0.3 },
      { candidateId: 'candidate_b', score: 0.9 },
    ],
    adaptiveAction: {
      selectedCandidateId: 'candidate_b',
      scoreBoost: 0.1,
      trace: { type: 'ab_mcts.action_selected', contextId: 'task-live-fusion' },
    },
    trajectoryOperators: [
      { candidateId: 'candidate_b', operator: 'recombination', parents: ['seed_1', 'seed_2'] },
    ],
    evaluator: ({ candidate }) => ({
      score: candidate.candidateId === 'candidate_b' ? 0.9 : 0.6,
      reasons: ['runtime fusion evidence'],
    }),
  });

  const [candidateA, candidateB] = result.candidates;
  assert.equal(result.candidateCount, 2);
  assert.equal(result.liveFusion.evidenceOnly, true);
  assert.equal(result.liveFusion.promotionAllowed, false);
  assert.deepEqual(result.liveFusion.orderedCandidateIds, ['candidate_b', 'candidate_a']);
  assert.equal(candidateA.bes.fusion.kind, 'patch_test_fusion');
  assert.equal(candidateA.bes.fusion.live.kind, 'live_bes_lane_fusion');
  assert.equal(candidateB.bes.fusion.live.rank, 1);
  assert.equal(candidateB.bes.fusion.live.scoreBreakdown.denseScore, 0.9);
  assert.equal(candidateB.bes.fusion.live.scoreBreakdown.backwardGoalScore, 0.5);
  assert.equal(candidateB.bes.fusion.evidenceOnly, true);
  assert.equal(candidateB.bes.fusion.promotionAuthority, false);
  assert.equal(candidateB.promotion.allowed, false);
});
