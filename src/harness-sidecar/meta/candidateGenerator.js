function makeCandidateId() {
  return `cand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateCandidateChange({ traceSummary, target }) {
  const failureModes = traceSummary.failureModes || [];
  const rationale = failureModes.length
    ? `Address observed failure modes: ${failureModes.join(', ')}`
    : 'Improve harness policy from trace observations';

  return {
    candidateId: makeCandidateId(),
    target,
    changeType: 'policy_adjustment',
    rationale,
    requiresApproval: true,
    patch: {
      description: `Proposed ${target} change`,
      applied: false,
    },
  };
}
