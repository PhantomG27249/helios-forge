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

function changesOf(proposal = {}) {
  return {
    ...(proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {}),
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
  };
}

function verifierFloorWeakened(proposal = {}) {
  const changes = changesOf(proposal);
  const floor = Number(
    changes.minVerifierPasses
      ?? changes.minimumVerifierPasses
      ?? changes.requiredVerifierPasses
      ?? changes.minPasses,
  );
  return proposal.kind === 'verifier_policy' && Number.isFinite(floor) && floor < 1;
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
  if (autoMergeRequested(proposal)) {
    return decision({ reason: 'auto_merge_rejected', reasons: ['auto_merge_rejected'] });
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
