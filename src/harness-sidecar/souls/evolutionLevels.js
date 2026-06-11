import { normalizeSoulRefs } from './soulEvidence.js';

export const EVOLUTION_LEVELS = Object.freeze([
  'subagent_soul',
  'subagent_society',
  'swarm_cell',
  'swarm',
  'oversoul',
  'local_harness',
  'global_harness',
  'meta_harness',
]);

const LEVEL_SET = new Set(EVOLUTION_LEVELS);
const SAFE_REF = /^[A-Za-z0-9_:-]+$/;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length ? normalized : null;
}

function safeRef(value) {
  const normalized = cleanString(value);
  if (!normalized || !SAFE_REF.test(normalized) || normalized.includes('..')) return null;
  return normalized;
}

function normalizeLevel(value, fallback = null) {
  const normalized = String(value || fallback || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return LEVEL_SET.has(normalized) ? normalized : null;
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function shallowEvolutionRef(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const level = normalizeLevel(value.level ?? value.evolutionLevel);
  const levelId = safeRef(value.levelId ?? value.id ?? value.societyId ?? value.cellId);
  if (!level || !levelId) return null;
  const version = cleanString(value.version ?? value.levelVersion);
  return {
    level,
    levelId,
    ...(version ? { version } : {}),
    evidenceOnly: true,
    promotionAuthority: false,
  };
}

export function normalizeEvolutionLevelRef(value = {}) {
  const base = shallowEvolutionRef(value);
  if (!base) return null;
  const parentRef = shallowEvolutionRef(value.parentRef ?? value.parentLevelRef);
  const childRefs = asArray(value.childRefs ?? value.childLevelRefs)
    .map(shallowEvolutionRef)
    .filter(Boolean);
  const lineagePath = uniqueSorted(asArray(value.lineagePath).map(safeRef).filter(Boolean));
  return {
    ...base,
    ...(parentRef ? { parentRef } : {}),
    ...(childRefs.length ? { childRefs } : {}),
    ...(lineagePath.length ? { lineagePath } : {}),
  };
}

export function normalizeEvolutionLevelRefs(value) {
  return asArray(value)
    .map((entry) => normalizeEvolutionLevelRef(entry))
    .filter(Boolean);
}

export function buildEvolutionLevelEnvelope({
  level,
  levelId,
  version,
  parentRef,
  childRefs = [],
  soulRefs,
  societyRefs = [],
  lineagePath = [],
} = {}) {
  const ref = normalizeEvolutionLevelRef({
    level,
    levelId,
    version,
    parentRef,
    childRefs,
    lineagePath,
  });
  if (!ref) throw new Error('valid evolution level ref is required');
  return {
    schemaVersion: 1,
    authority: 'evidence_only',
    canPromote: false,
    ref,
    soulRefs: normalizeSoulRefs(soulRefs),
    societyRefs: normalizeEvolutionLevelRefs(societyRefs),
  };
}

export function evolutionLevelRefCount(value) {
  return normalizeEvolutionLevelRefs(value).length;
}
