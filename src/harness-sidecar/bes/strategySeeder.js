const STRATEGIES_BY_TASK_TYPE = {
  coding_bugfix: [
    'reproduce_first',
    'minimal_patch',
    'test_first',
    'retrieval_first',
    'invariant_first',
    'reviewer_first',
  ],
  general: [
    'context_first',
    'minimal_action',
    'critic_review',
  ],
};

export function seedAttemptStrategies({ taskType = 'general', maxAttempts = 4 }) {
  const strategies = STRATEGIES_BY_TASK_TYPE[taskType] || STRATEGIES_BY_TASK_TYPE.general;
  return strategies.slice(0, maxAttempts).map((name, index) => ({
    id: `strategy_${index + 1}`,
    name,
    budgetWeight: index === 0 ? 1.0 : 0.8,
  }));
}
