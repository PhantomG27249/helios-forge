const LOCAL_SCOPES = new Set([
  'local',
  'local_config',
  'workspace',
  'workspace_local',
  'repo',
  'repo_local',
]);

const PRODUCTION_AUTONOMY_TABLES = Object.freeze({
  authority: 'evidence_only',
  canPromote: false,
  riskTiers: {
    low: {
      requiresHuman: false,
      requiresRollbackVerified: true,
    },
    medium: {
      requiresHuman: true,
      requiresRollbackVerified: true,
    },
    high: {
      requiresHuman: true,
      requiresRollbackVerified: true,
    },
  },
  candidateTypes: {
    local_config: {
      approvalNarrowingEligible: true,
      approvalScope: 'workspace_local_reversible',
      highRiskEscalation: true,
    },
    model_route_policy: {
      approvalNarrowingEligible: true,
      approvalScope: 'workspace_local_reversible',
      highRiskEscalation: true,
    },
    source_patch: {
      approvalNarrowingEligible: false,
      approvalScope: null,
      highRiskEscalation: true,
    },
    verifier_policy: {
      approvalNarrowingEligible: false,
      approvalScope: null,
      highRiskEscalation: true,
    },
    visual_policy: {
      approvalNarrowingEligible: true,
      approvalScope: 'workspace_local_reversible',
      highRiskEscalation: true,
      requiresVlmEvidence: true,
    },
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRisk(value) {
  const risk = String(value || 'low').toLowerCase();
  if (risk === 'critical') return 'high';
  if (risk === 'medium' || risk === 'high') return risk;
  return 'low';
}

function normalizeCandidateType(candidate = {}) {
  const explicit = candidate.candidateType || candidate.type || candidate.policyType;
  const changeType = candidate.changeType || candidate.kind || candidate.target;
  const value = String(explicit || changeType || '').toLowerCase();
  if (value.includes('source_patch') || value.includes('branch_mutation')) return 'source_patch';
  if (value.includes('verifier')) return 'verifier_policy';
  if (value.includes('visual') || candidate.visualImpact === true || candidate.visualImpacting === true) return 'visual_policy';
  if (value.includes('model_route') || value.includes('router')) return 'model_route_policy';
  if (value.includes('local_config') || value.includes('config')) return 'local_config';
  return 'source_patch';
}

function normalizeBoundary(trust = {}) {
  return trust.boundary || trust.trustKernel || trust.trustKernelBoundary || null;
}

function normalizeExternalEvidence(evidence = {}) {
  const source = evidence.externalPolicyEvidence || evidence.externalEvidence || null;
  if (!source) return null;
  return {
    id: source.id || source.evidenceId || source.policyId || null,
    authority: 'evidence_only',
    canPromote: false,
    canApprove: false,
  };
}

function hasInternalEvidence(evidence = {}) {
  return evidence.baselinePassed === true && evidence.heldOutPassed === true;
}

function rollbackVerified(rollback = {}) {
  return rollback?.rollbackVerified === true
    || rollback?.restoreVerified === true
    || rollback?.drillVerified === true;
}

function localScope(candidate = {}) {
  const scope = String(candidate.writeScope || candidate.scope || candidate.applyScope || 'workspace_local').toLowerCase();
  return LOCAL_SCOPES.has(scope);
}

function vlmRequired(candidate = {}, table = {}) {
  return table.requiresVlmEvidence === true
    || candidate.visualImpact === true
    || candidate.visualImpacting === true
    || String(candidate.taskKind || candidate.lane || '').toLowerCase() === 'visual'
    || String(candidate.taskKind || candidate.lane || '').toLowerCase() === 'vlm';
}

function vlmEvidencePassed(evidence = {}) {
  const vlm = evidence.vlm || evidence.visualEvidence || {};
  const hashes = vlm.artifactHashes || vlm.hashes || vlm.artifacts?.map?.((artifact) => artifact.hash || artifact.artifactHash);
  return (vlm.passed === true || vlm.verdict?.passed === true)
    && Array.isArray(hashes)
    && hashes.filter(Boolean).length > 0;
}

function trustedForNarrowApproval(trust = {}) {
  if (trust.external === true) return false;
  const tier = String(trust.tier || 'internal').toLowerCase();
  return tier === 'internal' || tier === 'verified';
}

function baseDecision(overrides = {}) {
  return {
    decision: 'escalated',
    authority: 'evidence_only',
    evidenceOnly: true,
    canPromote: false,
    canBypassTrustKernel: false,
    approvalScope: null,
    reasons: [],
    externalEvidence: null,
    ...overrides,
  };
}

export function listProductionAutonomyTables() {
  return clone(PRODUCTION_AUTONOMY_TABLES);
}

export function evaluateProductionAutonomyCandidate({
  autonomyLevel = 0,
  candidate = {},
  evidence = {},
  rollback = {},
  trust = {},
} = {}) {
  const tables = PRODUCTION_AUTONOMY_TABLES;
  const candidateType = normalizeCandidateType(candidate);
  const candidateTable = tables.candidateTypes[candidateType] || tables.candidateTypes.source_patch;
  const risk = normalizeRisk(candidate.risk);
  const riskTable = tables.riskTiers[risk] || tables.riskTiers.high;
  const boundary = normalizeBoundary(trust);
  const externalEvidence = normalizeExternalEvidence(evidence);
  const reasons = [];

  if (candidateTable.approvalNarrowingEligible === true) {
    reasons.push('candidate_type_allows_narrowed_approval');
  } else {
    reasons.push('candidate_type_requires_human');
  }

  if (riskTable.requiresHuman === true || risk === 'high') {
    reasons.push('high_risk_requires_human');
  } else {
    reasons.push('risk_tier_allows_narrowed_approval');
  }

  if (hasInternalEvidence(evidence)) {
    reasons.push('internal_evidence_passed');
  } else {
    reasons.push('missing_internal_evidence');
  }

  if (rollbackVerified(rollback)) {
    reasons.push('rollback_verified');
  } else {
    reasons.push('missing_verified_rollback');
  }

  if (!localScope(candidate)) {
    reasons.push('non_local_scope_requires_human');
  }

  if (!trustedForNarrowApproval(trust)) {
    reasons.push('untrusted_candidate');
  }

  if (boundary?.allowed === false) {
    reasons.push(`trust_kernel_blocked:${boundary.reason || 'boundary_rejected'}`);
  } else {
    reasons.push('trust_kernel_clear');
  }

  if (externalEvidence) {
    reasons.push('external_evidence_cannot_authorize');
  }

  if (vlmRequired(candidate, candidateTable)) {
    if (vlmEvidencePassed(evidence)) {
      reasons.push('vlm_evidence_passed');
    } else {
      reasons.push('missing_vlm_evidence');
    }
  }

  const blocked = reasons.some((reason) => (
    reason === 'candidate_type_requires_human'
      || reason === 'high_risk_requires_human'
      || reason === 'missing_internal_evidence'
      || reason === 'missing_verified_rollback'
      || reason === 'non_local_scope_requires_human'
      || reason === 'untrusted_candidate'
      || reason === 'external_evidence_cannot_authorize'
      || reason === 'missing_vlm_evidence'
      || reason.startsWith('trust_kernel_blocked:')
  ));

  return baseDecision({
    decision: blocked || Number(autonomyLevel) < 2 ? 'escalated' : 'eligible_for_narrowed_approval',
    approvalScope: blocked ? null : candidateTable.approvalScope,
    candidateType,
    risk,
    reasons,
    externalEvidence,
  });
}
