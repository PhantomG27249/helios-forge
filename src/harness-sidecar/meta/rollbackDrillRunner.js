function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeId(value, fallback = 'candidate') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function timestampPart(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid rollback drill timestamp: ${value}`);
  return date.toISOString().replace(/[-:.]/g, '').toLowerCase();
}

function candidateRollback(candidate = {}) {
  return candidate.rollback && typeof candidate.rollback === 'object' ? candidate.rollback : {};
}

export function runRollbackDrill({
  now = new Date(),
  candidate = {},
  verification = {},
} = {}) {
  const candidateId = safeId(candidate.candidateId ?? candidate.id);
  const rollback = candidateRollback(candidate);
  const artifacts = asArray(verification.artifacts).filter(Boolean);
  const blockers = [];

  if (rollback.reversible !== true) blockers.push('missing_reversible_rollback');
  if (artifacts.length === 0 && !rollback.restorePath) blockers.push('missing_rollback_artifact');
  if (verification.restoreVerified !== true) blockers.push('rollback_restore_not_verified');
  if (verification.baselinePassed === false) blockers.push('baseline_verification_failed');
  if (verification.postRollbackPassed !== true) blockers.push('post_rollback_verification_failed');

  const rollbackVerified = rollback.reversible === true
    && verification.restoreVerified === true
    && verification.postRollbackPassed === true
    && artifacts.length > 0;

  return {
    drillId: `rollback_${candidateId}_${timestampPart(now)}`,
    candidateId,
    candidateType: candidate.candidateType ?? candidate.type ?? null,
    evidenceOnly: true,
    canPromote: false,
    canBypassTrustKernel: false,
    rollbackVerified,
    status: blockers.length === 0 && rollbackVerified ? 'passed' : 'failed',
    blockers,
    rollback: {
      reversible: rollback.reversible === true,
      restorePath: rollback.restorePath ?? null,
    },
    verification: {
      restoreVerified: verification.restoreVerified === true,
      baselinePassed: verification.baselinePassed === true,
      postRollbackPassed: verification.postRollbackPassed === true,
      artifacts,
    },
  };
}
