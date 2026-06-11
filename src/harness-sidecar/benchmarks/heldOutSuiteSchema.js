import path from 'node:path';

import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

export const HELD_OUT_SUITE_DOMAINS = Object.freeze([
  'code',
  'memory',
  'research',
  'safety',
  'swarm',
  'tool',
  'visual',
]);

export const HELD_OUT_SUITE_METRICS = Object.freeze([
  'cost',
  'latency',
  'maintainability',
  'memoryHealth',
  'quality',
  'reliability',
  'safety',
  'trustRisk',
  'visualConfidence',
]);

const DOMAIN_SET = new Set(HELD_OUT_SUITE_DOMAINS);
const METRIC_SET = new Set(HELD_OUT_SUITE_METRICS);
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_ABSOLUTE_PATTERN = /^\\\\[^\\/]+[\\/][^\\/]+/;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function normalizeId(value, label = 'id') {
  const id = String(value || '').trim();
  if (!id) throw new Error(`${label} is required`);
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`);
  }
  return id;
}

function normalizeStringList(value, label, options = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${label} entries must be strings`);
    const text = item.trim();
    if (!text) continue;
    if (options.modelVisible === true) {
      assertModelVisibleSafe(text, label, { rejectPaths: true });
    }
    normalized.push(text);
  }
  return [...new Set(normalized)].sort();
}

function assertModelVisibleSafe(value, label, { rejectPaths = false } = {}) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const quarantine = quarantineModelVisiblePayload({ [label]: value });
  const rejectedReasons = rejectPaths
    ? ['secret_like_value', 'unsafe_path_value']
    : ['secret_like_value'];
  if (quarantine.reasons.some((reason) => rejectedReasons.includes(reason))) {
    throw new Error(`${label} contains unsafe model-visible content`);
  }
}

function hasTraversalSegment(value) {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '..');
}

function normalizeFixtureRef(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('fixtureRef must be a string');
  const fixtureRef = value.trim().replace(/\\/g, '/');
  if (!fixtureRef) return undefined;
  if (
    path.posix.isAbsolute(fixtureRef)
    || path.win32.isAbsolute(value)
    || WINDOWS_ABSOLUTE_PATTERN.test(value)
    || UNC_ABSOLUTE_PATTERN.test(value)
    || hasTraversalSegment(fixtureRef)
  ) {
    throw new Error('fixtureRef must be a relative path inside the suite fixture set');
  }
  assertModelVisibleSafe(fixtureRef, 'fixtureRef', { rejectPaths: true });
  return fixtureRef;
}

function normalizeDomains(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('domains is required');
  }
  const domains = [...new Set(value.map((domain) => String(domain || '').trim()).filter(Boolean))].sort();
  if (domains.length === 0) throw new Error('domains is required');
  for (const domain of domains) {
    if (!DOMAIN_SET.has(domain)) throw new Error(`unsupported domain: ${domain}`);
  }
  return domains;
}

function normalizeMetricWeights(value = {}) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, 'metricWeights');
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (!METRIC_SET.has(key)) throw new Error(`unsupported metricWeights key: ${key}`);
    const rawWeight = value[key];
    const rawType = typeof rawWeight;
    if (
      rawType !== 'number'
      && !(rawType === 'string' && rawWeight.trim() !== '')
    ) {
      throw new Error(`metricWeights.${key} must be a non-negative number`);
    }
    const weight = rawType === 'string' ? Number(rawWeight.trim()) : rawWeight;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`metricWeights.${key} must be a non-negative number`);
    }
    normalized[key] = weight;
  }
  return normalized;
}

function normalizeQuarantine(value) {
  if (value === undefined || value === null || value === false) {
    return { quarantined: false, reasons: [] };
  }
  if (value === true) {
    return { quarantined: true, reasons: [] };
  }
  assertPlainObject(value, 'quarantine');
  return {
    quarantined: value.quarantined === true,
    reasons: normalizeStringList(value.reasons, 'quarantine.reasons', { modelVisible: true }),
  };
}

function normalizeCase(input, suiteDomains) {
  assertPlainObject(input, 'case');
  const normalized = {
    id: normalizeId(input.id, 'case.id'),
  };

  if (input.domain !== undefined && input.domain !== null && input.domain !== '') {
    const domain = String(input.domain).trim();
    if (!DOMAIN_SET.has(domain)) throw new Error(`unsupported case domain: ${domain}`);
    if (!suiteDomains.includes(domain)) throw new Error(`case domain is not listed in suite domains: ${domain}`);
    normalized.domain = domain;
  }

  if (input.description !== undefined) {
    assertModelVisibleSafe(input.description, 'description');
    normalized.description = String(input.description);
  }

  const fixtureRef = normalizeFixtureRef(input.fixtureRef);
  if (fixtureRef) normalized.fixtureRef = fixtureRef;

  const expectedEvidence = normalizeStringList(input.expectedEvidence, 'expectedEvidence', { modelVisible: true });
  if (expectedEvidence.length > 0) normalized.expectedEvidence = expectedEvidence;

  normalized.quarantine = normalizeQuarantine(input.quarantine);
  return normalized;
}

export function normalizeHeldOutSuite(input, options = {}) {
  assertPlainObject(input, 'held-out suite');
  const id = normalizeId(input.id);
  const domains = normalizeDomains(input.domains);
  if (!Array.isArray(input.cases) || input.cases.length === 0) {
    throw new Error('cases is required');
  }

  const normalized = {
    schemaVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1,
    id,
    domains,
  };

  if (input.description !== undefined) {
    assertModelVisibleSafe(input.description, 'description');
    normalized.description = String(input.description);
  }

  normalized.metricWeights = normalizeMetricWeights(input.metricWeights);
  normalized.quarantine = normalizeQuarantine(input.quarantine);
  normalized.cases = input.cases
    .map((benchmarkCase) => normalizeCase(benchmarkCase, domains))
    .sort((left, right) => left.id.localeCompare(right.id));
  const caseIds = new Set();
  for (const benchmarkCase of normalized.cases) {
    if (caseIds.has(benchmarkCase.id)) {
      throw new Error(`duplicate case id: ${benchmarkCase.id}`);
    }
    caseIds.add(benchmarkCase.id);
  }

  if (options.requireCaseDomains === true) {
    for (const benchmarkCase of normalized.cases) {
      if (!benchmarkCase.domain) throw new Error(`case ${benchmarkCase.id} requires a domain`);
    }
  }

  return normalized;
}
