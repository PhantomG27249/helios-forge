import path from 'node:path';

const APPROVAL_REQUIRED_KINDS = new Set([
  'source_patch',
  'verifier_config_apply',
  'memory_deletion',
  'capability_install',
  'trust_kernel_mutation',
]);

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProposalPath(workspaceRoot, proposalPath) {
  if (path.isAbsolute(proposalPath) || /^[A-Za-z]:[\\/]/.test(proposalPath)) {
    return path.resolve(proposalPath);
  }
  return path.resolve(workspaceRoot, proposalPath);
}

function proposalPaths(proposal = {}) {
  if (Array.isArray(proposal.paths)) return proposal.paths;
  if (Array.isArray(proposal.files)) return proposal.files;
  if (typeof proposal.path === 'string') return [proposal.path];
  if (typeof proposal.file === 'string') return [proposal.file];
  return [];
}

function definedEntries(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function changesOf(proposal = {}) {
  return {
    ...(proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {}),
    ...definedEntries({
      auditEnabled: proposal.auditEnabled,
      auditLogEnabled: proposal.auditLogEnabled,
      auditRequired: proposal.auditRequired,
      disableAudit: proposal.disableAudit,
      secretRedactionEnabled: proposal.secretRedactionEnabled,
      redactSecrets: proposal.redactSecrets,
      secretsRedacted: proposal.secretsRedacted,
      disableSecretRedaction: proposal.disableSecretRedaction,
      autoMerge: proposal.autoMerge,
      autoMergeEnabled: proposal.autoMergeEnabled,
    }),
  };
}

function isSoulOrOversoulProposal(proposal = {}) {
  const kind = String(proposal.kind || '').toLowerCase();
  const target = String(proposal.target || '').toLowerCase();
  return kind.includes('soul')
    || target.includes('soul')
    || proposal.soulCandidate === true
    || proposal.oversoulCandidate === true;
}

function verifierFloorWeakened(proposal = {}) {
  const changes = changesOf(proposal);
  const floor = Number(
    changes.minVerifierPasses
      ?? changes.minimumVerifierPasses
      ?? changes.requiredVerifierPasses
      ?? changes.minPasses,
  );
  return (proposal.kind === 'verifier_policy' || isSoulOrOversoulProposal(proposal))
    && Number.isFinite(floor)
    && floor < 1;
}

function auditDisabled(proposal = {}) {
  const changes = changesOf(proposal);
  return changes.auditEnabled === false
    || changes.auditLogEnabled === false
    || changes.auditRequired === false
    || changes.disableAudit === true;
}

function secretRedactionDisabled(proposal = {}) {
  const changes = changesOf(proposal);
  return changes.secretRedactionEnabled === false
    || changes.redactSecrets === false
    || changes.secretsRedacted === false
    || changes.disableSecretRedaction === true;
}

function autoMergeRequested(proposal = {}) {
  const changes = changesOf(proposal);
  return proposal.kind === 'auto_merge'
    || proposal.autoMerge === true
    || changes.autoMerge === true
    || changes.autoMergeEnabled === true;
}

function soulAuthorityExpanded(proposal = {}) {
  if (!isSoulOrOversoulProposal(proposal)) return false;
  const changes = changesOf(proposal);
  const workspaceWriteScope = String(changes.workspaceWriteScope || changes.writeScope || '').toLowerCase();
  const authority = String(changes.authority || changes.authorityLevel || '').toLowerCase();
  const toolAuthority = asStructuredList(changes.toolAuthority || changes.toolAuthorities || changes.tools);
  const toolCaps = asStructuredList(changes.toolCaps?.allowed || changes.allowedTools);

  return changes.promotionAuthority === true
    || changes.approvalAuthority === true
    || changes.canPromote === true
    || changes.directApplyAllowed === true
    || changes.durableApplyApproved === true
    || ['global', 'repo', 'repository', 'workspace', 'all'].includes(workspaceWriteScope)
    || ['apply', 'promote', 'operator', 'approval', 'admin'].includes(authority)
    || toolAuthority.length > 0
    || toolCaps.length > 0;
}

function asStructuredList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function soulLineageHidden(proposal = {}) {
  if (!isSoulOrOversoulProposal(proposal)) return false;
  const changes = changesOf(proposal);
  return changes.hideLineage === true
    || changes.omitLineage === true
    || changes.stripLineage === true
    || changes.lineageRequired === false
    || changes.provenanceRequired === false;
}

function soulSelfApproved(proposal = {}) {
  if (!isSoulOrOversoulProposal(proposal)) return false;
  const changes = changesOf(proposal);
  return changes.selfApprove === true
    || changes.selfApproved === true
    || changes.approvedBySelf === true
    || changes.localApproval === true
    || changes.localApproved === true;
}

function visualTaskRequiresEvidence(proposal = {}) {
  const taskKind = String(proposal.taskKind ?? proposal.task?.kind ?? proposal.lane ?? '').toLowerCase();
  return proposal.visualEvidenceRequired === true
    || proposal.visualImpact === true
    || proposal.visualImpacting === true
    || taskKind === 'visual'
    || taskKind === 'vlm';
}

function visualReferencePath(reference = {}) {
  return reference?.path
    || reference?.artifacts?.image
    || reference?.artifacts?.diff
    || reference?.artifacts?.before
    || reference?.artifacts?.after;
}

function visualReferenceHash(reference = {}) {
  return reference?.hash
    || reference?.artifactHash
    || reference?.sha256
    || reference?.checksum
    || reference?.artifacts?.hash
    || reference?.artifacts?.sha256;
}

function evaluateVisualEvidence(visualEvidence = {}) {
  const artifacts = Array.isArray(visualEvidence.artifacts) ? visualEvidence.artifacts : [];
  const nodes = Array.isArray(visualEvidence.nodes) ? visualEvidence.nodes : [];
  const references = [...artifacts, ...nodes];
  const pathBackedReferences = references.filter((reference) => visualReferencePath(reference));
  const hasReferencePath = pathBackedReferences.length > 0;
  const allReferencesHashBacked = pathBackedReferences.every((reference) => visualReferenceHash(reference));

  if (visualEvidence.verdict?.passed !== true || !hasReferencePath) {
    return { valid: false, reason: 'missing_visual_evidence' };
  }
  if (!allReferencesHashBacked) {
    return { valid: false, reason: 'missing_visual_evidence_hash' };
  }
  return { valid: true, reason: null };
}

function hasExplicitApproval({ approved, approval, proposal }) {
  return approved === true || approval?.approved === true;
}

function decision(overrides = {}) {
  return {
    allowed: false,
    requiresApproval: false,
    reason: null,
    reasons: [],
    ...overrides,
  };
}

export function evaluateTrustKernelBoundary({
  workspaceRoot,
  proposal = {},
  approval = null,
  approved = false,
} = {}) {
  const kind = proposal.kind || 'unknown';
  const reasons = [];
  const paths = proposalPaths(proposal);

  if ((kind === 'source_patch' || proposal.patch || proposal.sourcePatch) && paths.length === 0) {
    return decision({
      reason: 'missing_patch_paths',
      reasons: ['missing_patch_paths'],
    });
  }

  if (workspaceRoot) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    for (const proposalPath of paths) {
      const resolvedPath = resolveProposalPath(resolvedWorkspaceRoot, proposalPath);
      if (!isInsideRoot(resolvedWorkspaceRoot, resolvedPath)) {
        return decision({
          reason: 'path_outside_workspace',
          reasons: ['path_outside_workspace'],
          path: proposalPath,
        });
      }
    }
  }

  if (verifierFloorWeakened(proposal)) {
    return decision({ reason: 'verifier_floor_weakened', reasons: ['verifier_floor_weakened'] });
  }
  if (auditDisabled(proposal)) {
    return decision({ reason: 'audit_disable_rejected', reasons: ['audit_disable_rejected'] });
  }
  if (secretRedactionDisabled(proposal)) {
    return decision({
      reason: 'secret_redaction_disable_rejected',
      reasons: ['secret_redaction_disable_rejected'],
    });
  }
  if (soulAuthorityExpanded(proposal)) {
    return decision({
      reason: 'soul_authority_expansion_rejected',
      reasons: ['soul_authority_expansion_rejected'],
    });
  }
  if (soulLineageHidden(proposal)) {
    return decision({
      reason: 'soul_lineage_hide_rejected',
      reasons: ['soul_lineage_hide_rejected'],
    });
  }
  if (soulSelfApproved(proposal)) {
    return decision({
      reason: 'soul_self_approval_rejected',
      reasons: ['soul_self_approval_rejected'],
    });
  }
  if (autoMergeRequested(proposal)) {
    return decision({ reason: 'auto_merge_rejected', reasons: ['auto_merge_rejected'] });
  }
  if (visualTaskRequiresEvidence(proposal)) {
    const visualEvidence = evaluateVisualEvidence(proposal.visualEvidence);
    if (!visualEvidence.valid) {
      return decision({
        requiresApproval: true,
        reason: visualEvidence.reason,
        reasons: [visualEvidence.reason],
      });
    }
  }

  if (APPROVAL_REQUIRED_KINDS.has(kind)) {
    const explicitlyApproved = hasExplicitApproval({ approved, approval, proposal });
    reasons.push(`${kind}_requires_approval`);
    return decision({
      allowed: explicitlyApproved,
      requiresApproval: !explicitlyApproved,
      reason: explicitlyApproved ? null : `${kind}_requires_approval`,
      reasons,
    });
  }

  return {
    allowed: true,
    requiresApproval: false,
    reason: null,
    reasons: ['trust_boundary_clear'],
  };
}
