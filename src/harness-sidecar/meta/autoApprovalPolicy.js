function hasCostApproval(approvals = []) {
  return approvals.some((approval = {}) => (
    approval.allowCostIncrease === true
      || approval.approveCostIncrease === true
      || approval.costOverride === true
  ));
}

function humanRequired(reason, extraReasons = []) {
  return {
    status: 'human_required',
    reasons: [reason, ...extraReasons],
    tier: 'human_required',
  };
}

export function decideAutoApproval({
  candidate = {},
  evidence = {},
  rollback = null,
  trust = {},
  approvals = [],
  policy = {},
} = {}) {
  const reasons = [];
  if (candidate.status === 'shadow_only') {
    return {
      status: 'shadow_only',
      reasons: ['shadow_only_never_mutates'],
      tier: 'shadow_only',
    };
  }

  if (candidate.changeType === 'branch_mutation' || candidate.mutatesBranch === true) {
    return humanRequired('branch_mutation_requires_human');
  }
  if (candidate.containsSecrets === true || candidate.secretBearing === true) {
    return humanRequired('secret_bearing_config_requires_human');
  }
  if (candidate.changeType === 'mcp_write_scope_expansion' || candidate.expandsWriteScope === true) {
    return humanRequired('mcp_write_scope_expansion_requires_human');
  }
  if (candidate.weakensVerifierSafety === true || candidate.safetyWeakening === true) {
    return humanRequired('verifier_safety_weakening_requires_human');
  }

  const costIncrease = Number(candidate.costIncrease || candidate.costDelta || 0);
  if (costIncrease > (policy.autoCostIncreaseLimit ?? 0) && !hasCostApproval(approvals)) {
    return humanRequired('cost_increase_requires_approval');
  }

  if (evidence.heldOutPassed === true) reasons.push('held_out_passed');
  if (evidence.baselinePassed === true) reasons.push('baseline_passed');
  if (rollback?.reversible === true) reasons.push('rollback_available');

  const localConfig = candidate.changeType === 'local_config' || candidate.target === 'local_config';
  const trusted = !trust.tier || ['internal', 'verified'].includes(String(trust.tier).toLowerCase());
  if (localConfig && evidence.heldOutPassed === true && evidence.baselinePassed === true && rollback?.reversible === true && trusted) {
    if (costIncrease > 0) reasons.push('cost_increase_approved');
    return {
      status: 'auto_approved',
      reasons,
      tier: 'local_config_only',
    };
  }

  const missing = [];
  if (!localConfig) missing.push('not_local_config');
  if (evidence.heldOutPassed !== true) missing.push('missing_held_out_pass');
  if (evidence.baselinePassed !== true) missing.push('missing_baseline_pass');
  if (rollback?.reversible !== true) missing.push('missing_rollback');
  if (!trusted) missing.push('untrusted_candidate');

  return {
    status: 'denied',
    reasons: missing,
    tier: 'never',
  };
}
