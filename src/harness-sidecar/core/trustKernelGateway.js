import { evaluateTrustKernelBoundary } from './trustKernelBoundary.js';

export function evaluateProposalTrustBoundary({
  workspaceRoot,
  proposal = {},
  evidence = {},
  visual = {},
} = {}) {
  const enrichedProposal = {
    ...proposal,
    ...(Object.keys(visual).length ? { visualEvidence: visual } : {}),
  };

  const kernelDecision = evaluateTrustKernelBoundary({
    workspaceRoot,
    proposal: enrichedProposal,
    approved: evidence.approved,
    approval: evidence.approval,
  });

  const boundary = {
    ...kernelDecision,
    authority: 'evidence_only',
  };

  return {
    allowed: boundary.allowed !== false,
    requiresApproval: boundary.requiresApproval === true,
    boundary,
    reasons: boundary.reasons?.length ? boundary.reasons : (boundary.reason ? [boundary.reason] : []),
    authority: 'evidence_only',
  };
}
