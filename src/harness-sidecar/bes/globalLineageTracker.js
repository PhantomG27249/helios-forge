function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
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
  compatibleFamily,
} = {}) {
  const normalizedCandidateId = normalizeId(candidateId, 'candidate');
  const normalizedParents = normalizeParents(parents);
  const normalizedOperator = normalizeId(operator, 'seed').toLowerCase();
  const operatorFamily = ['crossover', 'recombination'].includes(normalizedOperator) ? 'recombination' : 'mutation';
  const normalizedLane = lane ? normalizeId(lane).toLowerCase() : null;
  const normalizedFamily = normalizeId(
    compatibleFamily ?? localLineage?.compatibleFamily ?? localLineage?.family,
    normalizedLane ?? operatorFamily,
  ).toLowerCase();

  return {
    candidateId: normalizedCandidateId,
    parents: normalizedParents,
    operator: normalizedOperator,
    operatorFamily,
    compatibleFamily: normalizedFamily,
    promotionAuthority: false,
    lineageId: [
      normalizedCandidateId,
      normalizedOperator,
      ...normalizedParents,
    ].join(':'),
    ...(normalizedLane ? { lane: normalizedLane } : {}),
    ...(localLineage ? { localLineage } : {}),
  };
}
