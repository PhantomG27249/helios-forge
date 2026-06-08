export function recommendCostAwareAllocation({
  pressure = {},
  desired = {},
  policy = null,
} = {}) {
  const contextPercent = pressure.contextPercent || 0;
  const budgetPercent = pressure.budgetPercent || 0;
  const shouldDownshift = contextPercent >= 85 || budgetPercent >= 90;
  const retrievalItems = desired.retrievalItems || 0;
  const subagents = desired.subagents || 0;
  const events = [];

  if (!shouldDownshift) {
    const allocation = {
      retrievalItems,
      subagents,
      modelProfile: desired.modelProfile,
      events,
    };
    if (policy) {
      allocation.policy = {
        policyId: policy.policyId,
        status: policy.status || 'shadow_only',
        mode: 'metadata_only',
      };
    }
    return allocation;
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

  const allocation = {
    retrievalItems: Math.max(1, Math.floor(retrievalItems / 2)),
    subagents: Math.max(1, Math.floor(subagents / 2)),
    modelProfile: 'critic_low_temp',
    recommendation,
    events,
  };
  if (policy) {
    allocation.policy = {
      policyId: policy.policyId,
      status: policy.status || 'shadow_only',
      mode: 'metadata_only',
    };
  }
  return allocation;
}
