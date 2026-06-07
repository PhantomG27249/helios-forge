let proposalCounter = 0;

function makeProposalId() {
  proposalCounter += 1;
  return `proposal_${String(proposalCounter).padStart(4, '0')}`;
}

export function createChangeProposal({ candidate, promotionDecision, summary } = {}) {
  return {
    proposalId: makeProposalId(),
    candidateId: candidate?.candidateId,
    target: candidate?.target,
    status: 'approval_required',
    approvalRequired: true,
    directApplyAllowed: false,
    summary: summary || candidate?.rationale || 'Harness meta change proposal',
    rationale: candidate?.rationale,
    patch: candidate?.patch || null,
    promotionDecision,
    createdAt: new Date().toISOString(),
  };
}

export async function applyChangeProposal({ proposal, approved = false, applyAdapter } = {}) {
  if (!approved) {
    throw new Error('Change proposal apply approval required');
  }
  if (proposal?.directApplyAllowed) {
    throw new Error('Change proposal direct apply is not allowed');
  }
  if (typeof applyAdapter !== 'function') {
    throw new Error('applyAdapter is required');
  }

  const result = await applyAdapter({ proposal });
  return {
    proposalId: proposal.proposalId,
    candidateId: proposal.candidateId,
    status: 'applied',
    appliedAt: new Date().toISOString(),
    result,
  };
}
