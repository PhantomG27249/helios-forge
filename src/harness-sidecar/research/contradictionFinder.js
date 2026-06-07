function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeClaimValue(value) {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }

  return value;
}

export function findContradictions({ claims = [] } = {}) {
  const groups = new Map();

  for (const claim of claims) {
    if (!claim.subject || !claim.predicate) {
      continue;
    }

    const key = `${normalizeKeyPart(claim.subject)}::${normalizeKeyPart(claim.predicate)}`;
    const existing = groups.get(key) || [];
    existing.push(claim);
    groups.set(key, existing);
  }

  return [...groups.entries()].flatMap(([key, groupedClaims], index) => {
    const values = new Set(groupedClaims.map((claim) => normalizeClaimValue(claim.value)));

    if (values.size <= 1) {
      return [];
    }

    const [subject, predicate] = key.split('::');

    return [{
      contradictionId: `contra_${index + 1}`,
      subject,
      predicate,
      claimIds: groupedClaims.map((claim) => claim.claimId),
      evidence: groupedClaims.flatMap((claim) => claim.evidence || []),
      values: [...values],
    }];
  });
}
