const FAILURE_MODE_MUTATION = {
  verifier_failed: 'rerun_verifier',
  context_missing: 'expand_context',
  patch_too_large: 'minimize_patch',
};

export function proposeMutations({ missingSubgoalIds = [], failureModes = [], budget = 0 } = {}) {
  const maxBudget = Math.max(0, Math.floor(budget));
  const mutations = [];
  let spent = 0;

  for (const subgoalId of missingSubgoalIds) {
    if (spent + 1 > maxBudget) break;
    const failureMode = failureModes[spent] || 'subgoal_missing';
    mutations.push({
      id: `mutation_${mutations.length + 1}`,
      type: FAILURE_MODE_MUTATION[failureMode] || 'focus_subgoal',
      targetSubgoalId: subgoalId,
      failureMode,
      budgetCost: 1,
    });
    spent += 1;
  }

  return mutations;
}
