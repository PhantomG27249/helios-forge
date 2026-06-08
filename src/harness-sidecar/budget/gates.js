const GATE_RULES = [
  { field: 'toolCalls', limit: 'maxToolCalls', percent: 75, action: 'warn' },
  { field: 'toolCalls', limit: 'maxToolCalls', percent: 90, action: 'approval_required' },
  { field: 'toolCalls', limit: 'maxToolCalls', percent: 100, action: 'hard_stop' },
  { field: 'inputTokens', limit: 'maxInputTokens', percent: 75, action: 'warn' },
  { field: 'inputTokens', limit: 'maxInputTokens', percent: 90, action: 'approval_required' },
  { field: 'inputTokens', limit: 'maxInputTokens', percent: 100, action: 'hard_stop' },
];

function percentUsed(used, limit) {
  if (!limit) return 0;
  return Math.round(((used || 0) / limit) * 100);
}

function policyMetadata(policy) {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    status: policy.status || 'shadow_only',
    mode: 'metadata_only',
  };
}

export function evaluateBudgetGates({ used, limits, policy = null }) {
  const decisions = [];
  for (const rule of GATE_RULES) {
    const limit = limits[rule.limit];
    if (!limit) continue;
    const percent = percentUsed(used[rule.field], limit);
    if (percent >= rule.percent) {
      decisions.push({
        field: rule.field,
        limit: rule.limit,
        percent,
        threshold: rule.percent,
        action: percent >= 100 ? 'hard_stop' : rule.action,
      });
    }
  }

  const strongestAction = decisions.some((decision) => decision.action === 'hard_stop')
    ? 'hard_stop'
    : decisions.some((decision) => decision.action === 'approval_required')
      ? 'approval_required'
      : decisions.some((decision) => decision.action === 'warn')
        ? 'warn'
        : 'allow';

  const result = {
    action: strongestAction,
    decisions,
  };
  if (policy) {
    result.policy = policyMetadata(policy);
  }
  return result;
}
