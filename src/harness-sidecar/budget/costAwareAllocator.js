export function recommendCostAwareAllocation({
  pressure = {},
  desired = {},
} = {}) {
  const contextPercent = pressure.contextPercent || 0;
  const budgetPercent = pressure.budgetPercent || 0;
  const shouldDownshift = contextPercent >= 85 || budgetPercent >= 90;
  const retrievalItems = desired.retrievalItems || 0;
  const subagents = desired.subagents || 0;
  const events = [];

  if (!shouldDownshift) {
    return {
      retrievalItems,
      subagents,
      modelProfile: desired.modelProfile,
      events,
    };
  }

  const recommendation = {
    action: 'downshift_model_or_reduce_retrieval',
    reason: budgetPercent >= 90 ? 'budget_pressure' : 'context_pressure',
  };

  events.push({
    type: 'budget.downshift_recommended',
    recommendation,
    data: {
      contextPercent,
      budgetPercent,
    },
  });

  return {
    retrievalItems: Math.max(1, Math.floor(retrievalItems / 2)),
    subagents: Math.max(1, Math.floor(subagents / 2)),
    modelProfile: 'critic_low_temp',
    recommendation,
    events,
  };
}
