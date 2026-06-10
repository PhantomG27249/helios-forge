import { sanitizeCandidateId } from './frontierStore.js';

export const BENCHMARK_DIMENSIONS = Object.freeze([
  'quality',
  'safety',
  'reliability',
  'cost',
  'latency',
  'maintainability',
  'visualConfidence',
  'memoryHealth',
  'trustRisk',
]);

const HIGHER_IS_BETTER = Object.freeze([
  'quality',
  'safety',
  'reliability',
  'maintainability',
  'visualConfidence',
  'memoryHealth',
]);

const LOWER_IS_BETTER = Object.freeze([
  'cost',
  'latency',
  'trustRisk',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numericMetric(metrics = {}, key, fallback) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeBenchmarkMetrics(metrics = {}) {
  const normalized = {};
  for (const key of HIGHER_IS_BETTER) {
    normalized[key] = numericMetric(metrics, key, 0);
  }
  for (const key of LOWER_IS_BETTER) {
    normalized[key] = numericMetric(metrics, key, Number.POSITIVE_INFINITY);
  }
  return normalized;
}

function normalizeCase(testCase = {}) {
  return {
    ...testCase,
    caseId: sanitizeCandidateId(testCase.caseId),
  };
}

export function createHeldOutBenchmarkSuite({
  suiteId,
  description = '',
  cases = [],
  tags = [],
} = {}) {
  return {
    schemaVersion: 1,
    suiteId: sanitizeCandidateId(suiteId || 'benchmark-suite'),
    description,
    locked: true,
    authority: 'benchmark_evidence_only',
    canPromote: false,
    dimensions: [...BENCHMARK_DIMENSIONS],
    tags: asArray(tags).filter(Boolean),
    cases: asArray(cases).map(normalizeCase),
  };
}

function normalizeSuite(suite = {}) {
  if (suite.schemaVersion === 1 && suite.locked === true) {
    return {
      ...suite,
      suiteId: sanitizeCandidateId(suite.suiteId || 'benchmark-suite'),
      locked: true,
      authority: 'benchmark_evidence_only',
      canPromote: false,
      dimensions: [...BENCHMARK_DIMENSIONS],
      cases: asArray(suite.cases).map(normalizeCase),
    };
  }
  return createHeldOutBenchmarkSuite(suite);
}

function normalizeEntry(result = {}, cycle = {}) {
  return {
    candidateId: sanitizeCandidateId(result.candidateId),
    suiteId: cycle.suiteId,
    cycleId: cycle.cycleId,
    recordedAt: cycle.recordedAt,
    metrics: normalizeBenchmarkMetrics(result.metrics || result),
    dimensions: [...BENCHMARK_DIMENSIONS],
    source: result.source || null,
    notes: result.notes || '',
    promotionDecision: null,
    authority: 'benchmark_evidence_only',
    canPromote: false,
  };
}

function longitudinalMetricsDominate(left = {}, right = {}) {
  const leftMetrics = normalizeBenchmarkMetrics(left.metrics || left);
  const rightMetrics = normalizeBenchmarkMetrics(right.metrics || right);
  const noWorse = HIGHER_IS_BETTER.every((key) => leftMetrics[key] >= rightMetrics[key])
    && LOWER_IS_BETTER.every((key) => leftMetrics[key] <= rightMetrics[key]);
  const betterSomewhere = HIGHER_IS_BETTER.some((key) => leftMetrics[key] > rightMetrics[key])
    || LOWER_IS_BETTER.some((key) => leftMetrics[key] < rightMetrics[key]);
  return noWorse && betterSomewhere;
}

function updateFrontier(current = [], candidate = {}) {
  const candidateRecord = {
    ...candidate,
    candidateId: sanitizeCandidateId(candidate.candidateId),
    metrics: normalizeBenchmarkMetrics(candidate.metrics || candidate),
    promotionDecision: null,
    authority: 'benchmark_evidence_only',
    canPromote: false,
  };
  const frontier = asArray(current)
    .map((entry) => ({
      ...entry,
      candidateId: sanitizeCandidateId(entry.candidateId),
      metrics: normalizeBenchmarkMetrics(entry.metrics || entry),
      promotionDecision: null,
      authority: 'benchmark_evidence_only',
      canPromote: false,
    }))
    .filter((entry) => entry.candidateId !== candidateRecord.candidateId);

  if (frontier.some((entry) => longitudinalMetricsDominate(entry, candidateRecord))) {
    return frontier;
  }

  return [
    ...frontier.filter((entry) => !longitudinalMetricsDominate(candidateRecord, entry)),
    candidateRecord,
  ].sort((left, right) => (
    right.metrics.safety - left.metrics.safety
      || right.metrics.quality - left.metrics.quality
      || right.metrics.reliability - left.metrics.reliability
      || left.metrics.trustRisk - right.metrics.trustRisk
      || left.metrics.cost - right.metrics.cost
      || left.metrics.latency - right.metrics.latency
      || String(left.candidateId).localeCompare(String(right.candidateId))
  ));
}

function normalizeHistory(history = {}) {
  const cycles = asArray(history.cycles).map((cycle = {}) => ({
    ...cycle,
    suiteId: sanitizeCandidateId(cycle.suiteId || 'benchmark-suite'),
    entries: asArray(cycle.entries).map((entry) => normalizeEntry(entry, cycle)),
  }));
  let frontier = [];
  for (const cycle of cycles) {
    for (const entry of cycle.entries) {
      frontier = updateFrontier(frontier, entry);
    }
  }
  return {
    schemaVersion: 1,
    authority: 'advisory',
    canPromote: false,
    suites: asArray(history.suites).map(normalizeSuite),
    cycles,
    frontier,
  };
}

export function appendLongitudinalFrontierCycle({
  history = {},
  suite = {},
  cycleId,
  results = [],
  recordedAt = new Date().toISOString(),
} = {}) {
  const normalizedHistory = normalizeHistory(history);
  const normalizedSuite = normalizeSuite(suite);
  const cycle = {
    cycleId: sanitizeCandidateId(cycleId || `cycle-${normalizedHistory.cycles.length + 1}`),
    suiteId: normalizedSuite.suiteId,
    recordedAt,
    authority: 'benchmark_evidence_only',
    canPromote: false,
    dimensions: [...BENCHMARK_DIMENSIONS],
    entries: [],
  };
  cycle.entries = asArray(results).map((result) => normalizeEntry(result, cycle));

  let frontier = normalizedHistory.frontier;
  for (const entry of cycle.entries) {
    frontier = updateFrontier(frontier, entry);
  }

  const suites = [
    ...normalizedHistory.suites.filter((entry) => entry.suiteId !== normalizedSuite.suiteId),
    normalizedSuite,
  ].sort((left, right) => String(left.suiteId).localeCompare(String(right.suiteId)));

  return {
    schemaVersion: 1,
    authority: 'advisory',
    canPromote: false,
    suites,
    cycles: [...normalizedHistory.cycles, cycle],
    frontier,
  };
}
