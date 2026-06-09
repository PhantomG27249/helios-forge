const GLOBAL_FORWARD_REASON = 'local_meta_harness_cannot_self_authorize';

function hasDurableChange(candidate = {}) {
  return Boolean(
    candidate.durableApplyRequested
    || candidate.durableApplyApproved
    || candidate.suggestedCodeChange
    || candidate.codeChange
    || candidate.suggestedVerifierChange
    || candidate.verifierChange
    || candidate.suggestedMemoryPolicyChange
    || candidate.memoryPolicyChange
    || candidate.suggestedMemoryChange
    || (Array.isArray(candidate.memoryProposals) && candidate.memoryProposals.length > 0)
    || candidate.suggestedPolicyChange
    || candidate.policyChange,
  );
}

function appendReason(reasons = [], reason) {
  const normalized = Array.isArray(reasons) ? reasons : [reasons].filter(Boolean);
  if (normalized.includes(reason)) return normalized;
  return [...normalized, reason];
}

export function blockLocalDurablePromotion(candidate = {}) {
  const forwardToGlobal = Boolean(candidate.forwardToGlobal || hasDurableChange(candidate));
  return {
    ...candidate,
    durableApplyApproved: false,
    localOnly: true,
    forwardToGlobal,
    reasons: forwardToGlobal
      ? appendReason(candidate.reasons, GLOBAL_FORWARD_REASON)
      : (Array.isArray(candidate.reasons) ? candidate.reasons : []),
  };
}
