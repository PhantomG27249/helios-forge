function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeId(value, fallback) {
  return String(value ?? fallback).trim();
}

function normalizeParents(parents) {
  return [...new Set(asArray(parents).map((parent) => normalizeId(parent)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function recordLineage({
  candidateId,
  parents = [],
  operator = 'seed',
  lane,
  localLineage,
} = {}) {
  const normalizedCandidateId = normalizeId(candidateId, 'candidate');
  const normalizedParents = normalizeParents(parents);
  const normalizedOperator = normalizeId(operator, 'seed').toLowerCase();

  return {
    candidateId: normalizedCandidateId,
    parents: normalizedParents,
    operator: normalizedOperator,
    lineageId: [
      normalizedCandidateId,
      normalizedOperator,
      ...normalizedParents,
    ].join(':'),
    ...(lane ? { lane: normalizeId(lane).toLowerCase() } : {}),
    ...(localLineage ? { localLineage } : {}),
  };
}
