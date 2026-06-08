import { buildBackwardGoalTree } from './backwardGoalTree.js';
import { scoreGoalSatisfaction } from './goalSatisfactionScorer.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compareScoredCandidates(left, right) {
  const leftScore = left.goalScore?.score ?? 0;
  const rightScore = right.goalScore?.score ?? 0;
  if (rightScore !== leftScore) return rightScore - leftScore;
  return String(left.candidateId || left.id).localeCompare(String(right.candidateId || right.id));
}

function attachScore(candidate, goalTree) {
  return {
    ...candidate,
    goalScore: scoreGoalSatisfaction({ goalTree, candidate }),
  };
}

function mergeEvidence(left = {}, right = {}) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...asArray(left.evidence), ...asArray(right.evidence)]) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

function inheritPartialProgress(candidate, bestBefore) {
  if (!bestBefore) return candidate;
  return {
    ...candidate,
    evidence: mergeEvidence(bestBefore, candidate),
    lineage: {
      ...(candidate.lineage || {}),
      recombinedFrom: [
        ...asArray(candidate.lineage?.recombinedFrom),
        bestBefore.candidateId || bestBefore.id,
      ].filter(Boolean),
    },
  };
}

function defaultForwardSearch({ iteration, missingGoalIds }) {
  return [{
    candidateId: `bes_forward_${iteration}`,
    evidence: missingGoalIds.slice(0, 1).map((goalId) => ({ goalId, passed: true })),
  }];
}

function defaultBackwardRefine({ goalTree }) {
  return goalTree;
}

export function runBidirectionalBes({
  task = {},
  coreset,
  failureModes = [],
  visualCases = [],
  seedCandidates = [],
  iterations = 2,
  forwardSearch = defaultForwardSearch,
  backwardDecomposer = defaultBackwardRefine,
} = {}) {
  let goalTree = buildBackwardGoalTree({ task, coreset, failureModes, visualCases });
  const events = [{
    type: 'bes.backward_goal_tree_built',
    taskId: task.taskId,
    goalCount: goalTree.nodes.length,
  }];
  let frontier = asArray(seedCandidates).map((candidate) => attachScore(candidate, goalTree));
  const iterationRecords = [];
  const maxIterations = Math.max(0, Math.floor(iterations));

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const bestBefore = frontier.slice().sort(compareScoredCandidates)[0];
    const missingGoalIds = bestBefore?.goalScore?.missingGoalIds?.length
      ? bestBefore.goalScore.missingGoalIds
      : goalTree.nodes.filter((node) => node.id !== 'goal_root').map((node) => node.id);
    const generated = asArray(forwardSearch({
      iteration,
      task,
      goalTree,
      frontier,
      bestCandidate: bestBefore,
      missingGoalIds,
    })).map((candidate) => inheritPartialProgress(candidate, bestBefore));

    events.push({
      type: 'bes.forward_candidates_generated',
      taskId: task.taskId,
      iteration,
      candidateCount: generated.length,
      missingGoalIds,
    });

    frontier = [
      ...frontier,
      ...generated.map((candidate) => attachScore(candidate, goalTree)),
    ].sort(compareScoredCandidates);

    events.push({
      type: 'bes.goal_satisfaction_scored',
      taskId: task.taskId,
      iteration,
      bestCandidateId: frontier[0]?.candidateId || frontier[0]?.id,
      bestScore: frontier[0]?.goalScore?.score ?? 0,
    });

    const refined = backwardDecomposer({
      iteration,
      task,
      goalTree,
      frontier,
      denseFeedback: frontier[0]?.goalScore?.denseFeedback || [],
    }) || goalTree;
    goalTree = refined;
    frontier = frontier.map((candidate) => attachScore(candidate, goalTree)).sort(compareScoredCandidates);

    events.push({
      type: 'bes.backward_goal_tree_refined',
      taskId: task.taskId,
      iteration,
      goalCount: goalTree.nodes.length,
      bestCandidateId: frontier[0]?.candidateId || frontier[0]?.id,
    });

    iterationRecords.push({
      iteration,
      goalTree,
      generated,
      bestCandidate: frontier[0],
      missingGoalIds: frontier[0]?.goalScore?.missingGoalIds || [],
    });
  }

  events.push({
    type: 'bes.bidirectional_completed',
    taskId: task.taskId,
    bestCandidateId: frontier[0]?.candidateId || frontier[0]?.id,
    bestScore: frontier[0]?.goalScore?.score ?? 0,
  });

  return {
    task,
    goalTree,
    frontier,
    iterations: iterationRecords,
    bestCandidate: frontier[0] || null,
    events,
  };
}
