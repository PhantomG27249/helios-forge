import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBackwardGoalTree } from '../src/harness-sidecar/bes/backwardGoalTree.js';
import { runBidirectionalBes } from '../src/harness-sidecar/bes/bidirectionalSearchLoop.js';
import { verifyDenseSubgoals } from '../src/harness-sidecar/bes/denseSubgoalVerifier.js';
import { scoreGoalSatisfaction } from '../src/harness-sidecar/bes/goalSatisfactionScorer.js';

test('builds a backward goal tree from RHO failures and visual verifier cases', () => {
  const tree = buildBackwardGoalTree({
    task: { taskId: 'task_visual_fix', task: 'fix broken preview' },
    coreset: {
      items: [
        { taskId: 'trace_context', reasons: ['failure_or_recovery'], trace: { failureModes: ['context_missing'] } },
        {
          caseId: 'visual_ambiguous',
          source: 'verifier_case',
          reason: 'verifier_ambiguous_visual_score',
          verifierCase: {
            kind: 'visual',
            expected: { tags: ['visual', 'vlm'] },
            visualArtifacts: [{ type: 'screenshot', path: '.harness/visual/task/after.png' }],
          },
        },
      ],
    },
  });

  assert.equal(tree.root.id, 'goal_root');
  assert.equal(tree.nodes.some((node) => node.id === 'goal_context_missing'), true);
  assert.equal(tree.nodes.some((node) => node.id === 'goal_visual_verification'), true);
  assert.equal(tree.nodes.some((node) => node.check?.kind === 'visual'), true);
  assert.equal(tree.nodes.every((node) => Number.isFinite(node.weight)), true);
});

test('scores candidates densely against backward goals instead of only final pass/fail', () => {
  const tree = buildBackwardGoalTree({
    task: { taskId: 'task_visual_fix' },
    failureModes: ['context_missing', 'verifier_failed'],
    visualCases: [{ caseId: 'visual_layout', kind: 'visual', expected: { tags: ['visual'] } }],
  });

  const partial = scoreGoalSatisfaction({
    goalTree: tree,
    candidate: {
      candidateId: 'partial',
      evidence: [
        { goalId: 'goal_context_missing', passed: true, note: 'expanded relevant context' },
        { tags: ['visual'], passed: true, note: 'screenshot judged stable' },
      ],
    },
  });
  const empty = scoreGoalSatisfaction({
    goalTree: tree,
    candidate: { candidateId: 'empty', evidence: [] },
  });

  assert.equal(partial.satisfiedGoalIds.includes('goal_context_missing'), true);
  assert.equal(partial.satisfiedGoalIds.includes('goal_visual_verification'), true);
  assert.equal(partial.score > empty.score, true);
  assert.equal(partial.missingGoalIds.includes('goal_verifier_failed'), true);
  assert.equal(partial.denseFeedback.some((entry) => entry.status === 'missing'), true);
});

test('does not satisfy visual goals from failed or metadata-only visual evidence', () => {
  const tree = buildBackwardGoalTree({
    task: { taskId: 'task_visual_negative' },
    visualCases: [{ caseId: 'visual_layout', kind: 'visual', expected: { tags: ['visual'] } }],
  });

  const failed = scoreGoalSatisfaction({
    goalTree: tree,
    candidate: {
      candidateId: 'failed_visual',
      visual: { passed: false, caseIds: ['visual_layout'] },
      evidence: [{ tags: ['visual'], passed: false }],
    },
  });
  const metadataOnly = scoreGoalSatisfaction({
    goalTree: tree,
    candidate: {
      candidateId: 'metadata_only',
      visual: { caseIds: ['visual_layout'] },
    },
  });

  assert.equal(failed.satisfiedGoalIds.includes('goal_visual_verification'), false);
  assert.equal(metadataOnly.satisfiedGoalIds.includes('goal_visual_verification'), false);
  assert.equal(failed.missingGoalIds.includes('goal_visual_verification'), true);
  assert.equal(metadataOnly.missingGoalIds.includes('goal_visual_verification'), true);
});


test('bidirectional BES alternates forward candidates with backward goal refinement', () => {
  const result = runBidirectionalBes({
    task: { taskId: 'task_full_bes', task: 'repair UI and verifier policy' },
    coreset: {
      items: [
        { taskId: 'trace_verifier', reasons: ['verifier_false_negative'], trace: { failureModes: ['verifier_failed'] } },
        {
          caseId: 'visual_fn',
          source: 'verifier_case',
          verifierCase: { kind: 'visual', expected: { tags: ['visual', 'vlm'] } },
        },
      ],
    },
    seedCandidates: [
      {
        candidateId: 'seed_context',
        evidence: [{ goalId: 'goal_verifier_failed', passed: true }],
      },
    ],
    iterations: 2,
    forwardSearch: ({ iteration, missingGoalIds }) => [
      {
        candidateId: `candidate_${iteration}`,
        evidence: missingGoalIds.slice(0, iteration).map((goalId) => ({ goalId, passed: true })),
      },
    ],
  });

  assert.equal(result.iterations.length, 2);
  assert.equal(result.goalTree.nodes.some((node) => node.id === 'goal_visual_verification'), true);
  assert.equal(result.frontier.length >= 3, true);
  assert.equal(result.bestCandidate.candidateId, 'candidate_2');
  assert.equal(result.bestCandidate.goalScore.satisfiedGoalIds.includes('goal_visual_verification'), true);
  assert.deepEqual(
    result.events.map((event) => event.type),
    [
      'bes.backward_goal_tree_built',
      'bes.forward_candidates_generated',
      'bes.goal_satisfaction_scored',
      'bes.backward_goal_tree_refined',
      'bes.forward_candidates_generated',
      'bes.goal_satisfaction_scored',
      'bes.backward_goal_tree_refined',
      'bes.bidirectional_completed',
    ],
  );
});

test('dense subgoal verifier gives bidirectional feedback for partial evidence', () => {
  const result = verifyDenseSubgoals({
    subgoals: [
      { id: 'read_context', requires: 'read' },
      { id: 'run_tests', requires: 'npm test' },
    ],
    evidence: ['read repo context'],
  });

  assert.equal(result.score, 0.5);
  assert.deepEqual(result.satisfiedSubgoalIds, ['read_context']);
  assert.deepEqual(result.missingSubgoalIds, ['run_tests']);
});
