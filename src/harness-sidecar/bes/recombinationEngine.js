import { createAttemptGenome } from './attemptGenome.js';

function collectParentSubgoals(parents) {
  const ids = [];
  for (const parent of parents) {
    ids.push(...(parent.subgoalIds || []));
  }
  return [...new Set(ids)].sort();
}

function collectSolvedEvidence(parents, evidenceByAttemptId) {
  const solvedSubgoalIds = [];
  const evidence = [];

  for (const parent of parents) {
    const parentEvidence = evidenceByAttemptId[parent.id] || {};
    solvedSubgoalIds.push(...(parentEvidence.solvedSubgoalIds || []));
    evidence.push(...(parentEvidence.evidence || []));
  }

  const solvedSet = new Set(solvedSubgoalIds);
  return {
    solvedSubgoalIds: [...solvedSet].sort(),
    evidence: evidence
      .filter((entry) => solvedSet.has(entry.subgoalId))
      .sort((left, right) => left.subgoalId.localeCompare(right.subgoalId)),
  };
}

export function recombineAttempts({ id, parents = [], evidenceByAttemptId = {} } = {}) {
  const parentNames = parents.map((parent) => parent.strategy?.name).filter(Boolean);
  const parentIds = parents.map((parent) => parent.id).filter(Boolean);
  const { solvedSubgoalIds, evidence } = collectSolvedEvidence(parents, evidenceByAttemptId);
  const generation = Math.max(0, ...parents.map((parent) => parent.lineage?.generation || 0)) + 1;

  return createAttemptGenome({
    id,
    strategy: {
      id: `recombine_${parentIds.join('_') || 'seed'}`,
      name: `recombine:${parentNames.join('+') || 'unknown'}`,
    },
    subgoalIds: collectParentSubgoals(parents),
    mutations: [],
    lineage: {
      parents: parentIds,
      generation,
    },
    solvedSubgoalIds,
    evidence,
  });
}
