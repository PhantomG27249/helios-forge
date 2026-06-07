function hasEvidence(record) {
  return Array.isArray(record.evidence) && record.evidence.length > 0;
}

function hasContradiction(record) {
  return Array.isArray(record.contradictions) && record.contradictions.length > 0;
}

export function decideReflectionGate(record = {}) {
  const reasons = [];

  if (record.reviewStatus === 'quarantined') reasons.push('already_quarantined');
  if (record.stale || record.supersededBy) reasons.push('superseded');
  if (hasContradiction(record)) reasons.push('contradiction_detected');

  if (reasons.length > 0) {
    return { status: 'quarantined', reasons };
  }

  if (hasEvidence(record)) {
    reasons.push('evidence_present');
  } else {
    reasons.push('evidence_missing');
  }

  if (record.reviewStatus === 'reviewed' || record.reviewStatus === 'approved') {
    reasons.push('reviewed');
  } else {
    reasons.push('review_pending');
  }

  if (record.validatorBacked) {
    reasons.push('validator_backed');
  } else {
    reasons.push('validator_missing');
  }

  const promotable = hasEvidence(record)
    && (record.reviewStatus === 'reviewed' || record.reviewStatus === 'approved')
    && record.validatorBacked === true;

  return {
    status: promotable ? 'promotable' : 'needs_review',
    reasons,
  };
}
