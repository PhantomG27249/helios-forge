function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function safeReferenceId(value) {
  const normalized = cleanString(value);
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function uniqueSorted(values = []) {
  return [...new Set(asArray(values).map(safeReferenceId).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeSoulRefs(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.soulRefs && typeof value.soulRefs === 'object' && !Array.isArray(value.soulRefs)
    ? value.soulRefs
    : value;
  const refs = {};
  const soulId = safeReferenceId(source.soulId ?? source.agentId);
  const soulVersion = cleanString(source.soulVersion ?? source.version);
  const oversoulVersion = cleanString(source.oversoulVersion);
  const mutationLineage = uniqueSorted(source.mutationLineage ?? source.lineage);

  if (soulId) refs.soulId = soulId;
  if (soulVersion) refs.soulVersion = soulVersion;
  if (oversoulVersion) refs.oversoulVersion = oversoulVersion;
  if (mutationLineage.length > 0) refs.mutationLineage = mutationLineage;

  if (Object.keys(refs).length === 0) return null;
  return {
    ...refs,
    evidenceOnly: true,
    promotionAuthority: false,
  };
}

export function normalizeSoulRefList(value) {
  return asArray(value)
    .map((entry) => normalizeSoulRefs(entry))
    .filter(Boolean);
}

export function soulRefCount(value) {
  return normalizeSoulRefList(value).length;
}
