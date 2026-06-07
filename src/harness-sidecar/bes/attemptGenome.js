function normalizeSubgoalIds(subgoals = [], subgoalIds = []) {
  const ids = subgoalIds.length
    ? subgoalIds
    : subgoals.map((subgoal) => subgoal.id).filter(Boolean);
  return [...new Set(ids)].sort();
}

function normalizeMutations(mutations = []) {
  return mutations.map((mutation, index) => ({
    id: mutation.id || `mutation_${index + 1}`,
    type: mutation.type,
    targetSubgoalId: mutation.targetSubgoalId,
    failureMode: mutation.failureMode,
    budgetCost: Number.isFinite(mutation.budgetCost) ? mutation.budgetCost : 1,
  }));
}

export function createAttemptGenome({
  id,
  strategy,
  subgoals = [],
  subgoalIds = [],
  mutations = [],
  lineage = {},
  solvedSubgoalIds = [],
  evidence = [],
} = {}) {
  const genome = {
    id,
    strategy: strategy ? { ...strategy } : null,
    subgoalIds: normalizeSubgoalIds(subgoals, subgoalIds),
    mutations: normalizeMutations(mutations),
    lineage: {
      parents: lineage.parents ? [...lineage.parents] : [],
      generation: Number.isInteger(lineage.generation) ? lineage.generation : 0,
    },
    solvedSubgoalIds: [...new Set(solvedSubgoalIds)].sort(),
    evidence: evidence.map((entry) => ({ ...entry })),
  };

  return genome;
}

export function validateAttemptGenome(genome) {
  const errors = [];

  if (!genome || typeof genome !== 'object') {
    return { valid: false, errors: ['genome must be an object'] };
  }
  if (!genome.id) errors.push('id is required');
  if (!genome.strategy || !genome.strategy.name) errors.push('strategy.name is required');
  if (!Array.isArray(genome.subgoalIds) || genome.subgoalIds.length === 0) {
    errors.push('at least one subgoal is required');
  }
  if (!Array.isArray(genome.mutations)) errors.push('mutations must be an array');
  if (!genome.lineage || !Array.isArray(genome.lineage.parents)) {
    errors.push('lineage.parents must be an array');
  }

  for (const mutation of genome.mutations || []) {
    if (!mutation.type) errors.push('mutation.type is required');
    if (!Number.isFinite(mutation.budgetCost) || mutation.budgetCost < 0) {
      errors.push('mutation.budgetCost must be a non-negative number');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
