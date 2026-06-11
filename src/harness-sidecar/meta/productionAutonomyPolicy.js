import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const CANDIDATE_TYPES = Object.freeze({
  docs: { type: 'documentation_change', maxAutonomyLevel: 1 },
  documentation: { type: 'documentation_change', maxAutonomyLevel: 1 },
  config: { type: 'configuration_change', maxAutonomyLevel: 2 },
  configuration: { type: 'configuration_change', maxAutonomyLevel: 2 },
  prompt: { type: 'prompt_policy_change', maxAutonomyLevel: 2 },
  prompt_policy: { type: 'prompt_policy_change', maxAutonomyLevel: 2 },
  skill: { type: 'skill_policy_change', maxAutonomyLevel: 2 },
  skill_policy: { type: 'skill_policy_change', maxAutonomyLevel: 2 },
  verifier: { type: 'verifier_policy_change', maxAutonomyLevel: 0 },
  verifier_policy: { type: 'verifier_policy_change', maxAutonomyLevel: 0 },
  code: { type: 'source_code_change', maxAutonomyLevel: 0 },
  source: { type: 'source_code_change', maxAutonomyLevel: 0 },
  source_patch: { type: 'source_code_change', maxAutonomyLevel: 0 },
  model_routing: { type: 'model_routing_change', maxAutonomyLevel: 1 },
  router: { type: 'model_routing_change', maxAutonomyLevel: 1 },
  a2a_transport: { type: 'external_transport_change', maxAutonomyLevel: 0 },
  external_transport: { type: 'external_transport_change', maxAutonomyLevel: 0 },
  visual_policy: { type: 'visual_policy_change', maxAutonomyLevel: 0 },
  memory_policy: { type: 'memory_policy_change', maxAutonomyLevel: 0 },
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRisk({ candidate = {}, risk = {} } = {}) {
  if (typeof risk === 'string') return risk.toLowerCase();
  return String(candidate.risk || risk.level || risk.risk || 'medium').toLowerCase();
}

function productionGate(operatorPolicy = {}) {
  const gate = operatorPolicy.productionCapabilities?.productionAutonomyPolicy
    || operatorPolicy.productionAutonomyPolicy
    || {};
  return {
    enabled: gate.enabled === true,
    mode: gate.mode || 'advisory',
    authority: 'evidence_only',
  };
}

function normalizeCandidateType(candidate = {}) {
  const raw = String(
    candidate.candidateType
      || candidate.type
      || candidate.target
      || candidate.changeType
      || 'code',
  ).toLowerCase();
  return CANDIDATE_TYPES[raw] || { type: 'source_code_change', maxAutonomyLevel: 0 };
}

function addUnique(list, reason) {
  if (reason && !list.includes(reason)) list.push(reason);
}

function localScope(candidate = {}) {
  const scope = String(candidate.writeScope || candidate.scope || candidate.applyScope || candidate.changeType || '').toLowerCase();
  return ['local', 'local_config', 'workspace_local', 'repo_local', 'configuration_change'].includes(scope);
}

function containsRedactedValue(value) {
  if (typeof value === 'string') {
    return value === '[redacted]' || value === '[redacted:path]' || value.includes('[redacted');
  }
  if (Array.isArray(value)) return value.some((item) => containsRedactedValue(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsRedactedValue(item));
  }
  return false;
}

function rollbackEvidence(candidate = {}, evidence = {}) {
  const rollback = asObject(evidence.rollback || candidate.rollback);
  const redacted = containsRedactedValue(rollback);
  const reversible = !redacted && (
    rollback.reversible === true || rollback.available === true || Boolean(rollback.drillId)
  );
  return {
    required: true,
    available: reversible,
    redacted,
    rollback,
  };
}

function verifierFloorWeakened(candidate = {}) {
  const changes = asObject(candidate.changes);
  const floor = Number(
    changes.minVerifierPasses
      ?? changes.minimumVerifierPasses
      ?? changes.requiredVerifierPasses
      ?? changes.minPasses
      ?? candidate.minVerifierPasses,
  );
  return Number.isFinite(floor) && floor < 1;
}

function visualReferences(visual = {}) {
  return [
    ...(Array.isArray(visual.artifacts) ? visual.artifacts : []),
    ...(Array.isArray(visual.nodes) ? visual.nodes : []),
  ];
}

function visualReferencePath(reference = {}) {
  return reference.path
    || reference.artifactPath
    || reference.artifacts?.image
    || reference.artifacts?.diff
    || reference.artifacts?.before
    || reference.artifacts?.after;
}

function visualReferenceHash(reference = {}) {
  return reference.hash
    || reference.artifactHash
    || reference.sha256
    || reference.checksum
    || reference.artifacts?.hash
    || reference.artifacts?.sha256;
}

function visualEvidencePassed(evidence = {}) {
  const visual = asObject(evidence.visual || evidence.vlm || evidence.visualEvidence);
  if (visual.external === true && visual.verified !== true) return false;
  if (visual.verdict?.passed !== true) return false;
  const pathBackedReferences = visualReferences(visual).filter((reference) => visualReferencePath(reference));
  return pathBackedReferences.length > 0
    && pathBackedReferences.every((reference) => Boolean(visualReferenceHash(reference)));
}

function visualEvidenceRequired(candidate = {}, operatorPolicy = {}) {
  const taskKind = String(candidate.taskKind || candidate.lane || '').toLowerCase();
  return operatorPolicy.visualEvidence?.requireVlmForVisualImpact === true
    || candidate.visualImpact === true
    || candidate.visualImpacting === true
    || candidate.vlmRequired === true
    || taskKind === 'visual'
    || taskKind === 'vlm';
}

function externalA2aEvidence(evidence = {}) {
  return asObject(evidence.externalA2A || evidence.externalA2a || evidence.a2a);
}

function overrideDetails({ risk = {}, operatorPolicy = {} } = {}) {
  if (typeof risk === 'object' && risk?.override) return risk.override;
  return operatorPolicy.override || null;
}

export function evaluateProductionAutonomy({
  candidate = {},
  evidence = {},
  risk = {},
  operatorPolicy = {},
} = {}) {
  const gate = productionGate(operatorPolicy);
  const { type: candidateType, maxAutonomyLevel } = normalizeCandidateType(candidate);
  const riskLevel = normalizeRisk({ candidate, risk });
  const blockers = [];
  const reasons = [];
  const quarantined = quarantineModelVisiblePayload({
    candidate,
    evidence,
  });
  const safeCandidate = quarantined.value.candidate || {};
  const safeEvidence = quarantined.value.evidence || {};
  const safeExternalA2A = externalA2aEvidence(safeEvidence);
  const rollback = rollbackEvidence(safeCandidate, safeEvidence);
  const override = overrideDetails({ risk, operatorPolicy });
  const approvalNarrowing = {
    eligible: false,
    tier: 'none',
    authority: 'eligibility_only',
  };

  if (!gate.enabled) {
    addUnique(blockers, 'production_autonomy_policy_disabled');
    addUnique(reasons, 'production_autonomy_policy_disabled');
  }

  if (riskLevel === 'high' || candidate.highRisk === true) {
    addUnique(blockers, 'high_risk_requires_human');
    addUnique(reasons, 'high_risk_requires_human');
  }

  if (!rollback.available) {
    addUnique(blockers, 'rollback_required');
    addUnique(reasons, 'rollback_required');
  }

  if (verifierFloorWeakened(candidate)) {
    addUnique(blockers, 'verifier_floor_weakened');
    addUnique(reasons, 'verifier_floor_weakened');
  }

  if (safeExternalA2A.external === true && safeExternalA2A.verified !== true) {
    const allowUnverified = operatorPolicy.externalEvidence?.allowUnverifiedA2A === true;
    if (!allowUnverified) {
      addUnique(blockers, 'external_a2a_unverified');
      addUnique(reasons, 'external_a2a_unverified');
    }
  }

  const vlmEvidenceSatisfied = visualEvidencePassed(safeEvidence);
  if (visualEvidenceRequired(candidate, operatorPolicy) && !vlmEvidenceSatisfied) {
    addUnique(blockers, 'missing_vlm_visual_evidence');
    addUnique(reasons, 'missing_vlm_visual_evidence');
  }

  const lowRisk = riskLevel === 'low' || candidate.lowRisk === true;
  if (
    gate.enabled
    && lowRisk
    && rollback.available
    && localScope(candidate)
    && maxAutonomyLevel >= 2
    && !blockers.length
  ) {
    approvalNarrowing.eligible = true;
    approvalNarrowing.tier = 'low_risk_reversible_local';
    addUnique(reasons, 'approval_narrowing_eligibility_only');
  }

  const requiresHumanApproval = blockers.includes('high_risk_requires_human')
    || maxAutonomyLevel === 0
    || (!approvalNarrowing.eligible && riskLevel !== 'low');
  const promotionEligible = gate.enabled && blockers.length === 0 && (!requiresHumanApproval || approvalNarrowing.eligible);

  return {
    candidateId: candidate.candidateId || candidate.id || null,
    candidateType,
    maxAutonomyLevel,
    authority: 'evidence_only',
    gate,
    risk: {
      level: riskLevel,
    },
    approvalNarrowing,
    requiresHumanApproval,
    promotionEligible,
    canPromote: promotionEligible,
    canApply: false,
    directApplyAllowed: false,
    blockers,
    reasons,
    escalation: {
      required: requiresHumanApproval || blockers.length > 0,
      reasons: blockers.length ? [...blockers] : (requiresHumanApproval ? ['human_approval_required'] : []),
    },
    evidencePolicy: {
      externalA2A: Object.keys(safeExternalA2A).length ? safeExternalA2A : null,
      visualEvidenceRequired: visualEvidenceRequired(candidate, operatorPolicy),
      vlmEvidenceSatisfied,
    },
    rollbackPolicy: rollback,
    quarantine: {
      quarantined: quarantined.quarantined,
      reasons: quarantined.reasons,
      redacted: quarantined.redacted,
    },
    overrideAudit: {
      required: Boolean(override),
      approvedBy: override?.approvedBy || null,
      reason: override?.reason || null,
      authority: 'audit_only',
    },
    modelVisibleSummary: {
      value: quarantined.value,
      quarantined: quarantined.quarantined,
    },
  };
}
