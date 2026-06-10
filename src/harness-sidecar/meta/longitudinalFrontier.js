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

function roundMetric(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function normalizeAccounting({ accounting = {}, budget = {}, suite = {}, entries = [] } = {}) {
  const spentSource = accounting.spentUsd ?? budget.spentUsd;
  const remainingSource = accounting.remainingUsd ?? budget.remainingUsd;
  const maxSource = accounting.maxUsd ?? budget.maxUsd;
  return {
    spentUsd: roundMoney(spentSource),
    remainingUsd: remainingSource === null || remainingSource === undefined
      ? null
      : roundMoney(remainingSource),
    maxUsd: maxSource === null || maxSource === undefined
      ? null
      : roundMoney(maxSource),
    blockedJobCount: Number(accounting.blockedJobCount ?? budget.blockedJobCount ?? 0),
    entryCount: asArray(entries).length,
    caseCount: asArray(suite.cases).length,
  };
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

function bestEntryForComparison(entries = []) {
  return [...entries].sort((left, right) => (
    right.metrics.safety - left.metrics.safety
      || right.metrics.quality - left.metrics.quality
      || right.metrics.reliability - left.metrics.reliability
      || left.metrics.trustRisk - right.metrics.trustRisk
      || left.metrics.cost - right.metrics.cost
      || left.metrics.latency - right.metrics.latency
      || String(left.candidateId).localeCompare(String(right.candidateId))
  ))[0] || null;
}

function findPreviousEntry(entry = {}, previousCycles = []) {
  const newestFirst = [...previousCycles].reverse();
  const sameCandidateCycle = newestFirst.find((cycle) => (
    cycle.suiteId === entry.suiteId
      && cycle.entries.some((candidate) => candidate.candidateId === entry.candidateId)
  ));
  if (sameCandidateCycle) {
    return sameCandidateCycle.entries.find((candidate) => candidate.candidateId === entry.candidateId);
  }
  const previousSuiteCycle = newestFirst.find((cycle) => cycle.suiteId === entry.suiteId);
  return previousSuiteCycle ? bestEntryForComparison(previousSuiteCycle.entries) : null;
}

function dimensionDelta(currentMetrics = {}, previousMetrics = {}, key) {
  const current = currentMetrics[key];
  const previous = previousMetrics[key];
  const rawDelta = roundMetric(current - previous);
  const directionalDelta = LOWER_IS_BETTER.includes(key)
    ? roundMetric(previous - current)
    : rawDelta;
  let classification = 'unchanged';
  if (directionalDelta > 0) classification = 'improvement';
  if (directionalDelta < 0) classification = 'regression';
  return {
    previous,
    current,
    rawDelta,
    directionalDelta,
    classification,
  };
}

function classifyDeltas(dimensionDeltas = {}) {
  const classifications = Object.values(dimensionDeltas).map((delta) => delta.classification);
  const improvementCount = classifications.filter((value) => value === 'improvement').length;
  const regressionCount = classifications.filter((value) => value === 'regression').length;
  if (improvementCount === 0 && regressionCount === 0) return 'unchanged';
  if (regressionCount === 0) return 'improvement';
  if (improvementCount === 0 || regressionCount > improvementCount) return 'regression';
  return 'mixed';
}

function compareEntry(entry = {}, previousCycles = []) {
  const previous = findPreviousEntry(entry, previousCycles);
  if (!previous) {
    return {
      classification: 'new',
      previousCycleId: null,
      previousCandidateId: null,
      dimensionDeltas: {},
    };
  }

  const currentMetrics = normalizeBenchmarkMetrics(entry.metrics);
  const previousMetrics = normalizeBenchmarkMetrics(previous.metrics);
  const dimensionDeltas = Object.fromEntries(BENCHMARK_DIMENSIONS.map((key) => [
    key,
    dimensionDelta(currentMetrics, previousMetrics, key),
  ]));
  return {
    classification: classifyDeltas(dimensionDeltas),
    previousCycleId: previous.cycleId,
    previousCandidateId: previous.candidateId,
    dimensionDeltas,
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
  const suites = asArray(history.suites).map(normalizeSuite);
  const suiteById = new Map(suites.map((suite) => [suite.suiteId, suite]));
  const cycles = [];
  for (const rawCycle of asArray(history.cycles)) {
    const cycle = {
      ...rawCycle,
      cycleId: sanitizeCandidateId(rawCycle.cycleId || `cycle-${cycles.length + 1}`),
      suiteId: sanitizeCandidateId(rawCycle.suiteId || 'benchmark-suite'),
      authority: 'benchmark_evidence_only',
      canPromote: false,
      dimensions: [...BENCHMARK_DIMENSIONS],
    };
    cycle.entries = asArray(rawCycle.entries).map((entry) => normalizeEntry(entry, cycle));
    cycle.accounting = normalizeAccounting({
      accounting: rawCycle.accounting,
      suite: suiteById.get(cycle.suiteId),
      entries: cycle.entries,
    });
    cycle.entries = cycle.entries.map((entry) => ({
      ...entry,
      comparison: compareEntry(entry, cycles),
    }));
    cycles.push(cycle);
  }
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
    suites,
    cycles,
    frontier,
  };
}

export function appendLongitudinalFrontierCycle({
  history = {},
  suite = {},
  cycleId,
  results = [],
  budget = {},
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
    accounting: normalizeAccounting({ budget, suite: normalizedSuite, entries: results }),
    entries: [],
  };
  cycle.entries = asArray(results).map((result) => normalizeEntry(result, cycle));

  const suites = [
    ...normalizedHistory.suites.filter((entry) => entry.suiteId !== normalizedSuite.suiteId),
    normalizedSuite,
  ].sort((left, right) => String(left.suiteId).localeCompare(String(right.suiteId)));

  return normalizeHistory({
    schemaVersion: 1,
    authority: 'advisory',
    canPromote: false,
    suites,
    cycles: [...normalizedHistory.cycles, cycle],
  });
}

function classificationCounts(rows = []) {
  const counts = {
    improvement: 0,
    mixed: 0,
    new: 0,
    regression: 0,
    unchanged: 0,
  };
  for (const row of rows) {
    if (Object.hasOwn(counts, row.classification)) counts[row.classification] += 1;
  }
  return counts;
}

function summarizeAccounting(cycles = []) {
  return cycles.reduce((summary, cycle) => ({
    spentUsd: roundMoney(summary.spentUsd + Number(cycle.accounting?.spentUsd || 0)),
    remainingUsd: cycle.accounting?.remainingUsd ?? summary.remainingUsd,
    maxUsd: cycle.accounting?.maxUsd ?? summary.maxUsd,
    blockedJobCount: summary.blockedJobCount + Number(cycle.accounting?.blockedJobCount || 0),
    entryCount: summary.entryCount + Number(cycle.accounting?.entryCount || 0),
    caseCount: Math.max(summary.caseCount, Number(cycle.accounting?.caseCount || 0)),
  }), {
    spentUsd: 0,
    remainingUsd: null,
    maxUsd: null,
    blockedJobCount: 0,
    entryCount: 0,
    caseCount: 0,
  });
}

export function summarizeLongitudinalFrontier(history = {}) {
  const normalizedHistory = normalizeHistory(history);
  const frontierIds = new Set(normalizedHistory.frontier.map((entry) => entry.candidateId));
  const dashboardRows = normalizedHistory.cycles.flatMap((cycle) => (
    cycle.entries.map((entry) => ({
      suiteId: cycle.suiteId,
      cycleId: cycle.cycleId,
      recordedAt: cycle.recordedAt,
      candidateId: entry.candidateId,
      classification: entry.comparison?.classification || 'new',
      previousCycleId: entry.comparison?.previousCycleId || null,
      previousCandidateId: entry.comparison?.previousCandidateId || null,
      frontierMember: frontierIds.has(entry.candidateId),
      metrics: normalizeBenchmarkMetrics(entry.metrics),
      dimensionDeltas: entry.comparison?.dimensionDeltas || {},
      accounting: cycle.accounting,
      authority: 'benchmark_evidence_only',
      canPromote: false,
    }))
  ));

  return {
    schemaVersion: 1,
    authority: 'advisory',
    canPromote: false,
    suiteCount: normalizedHistory.suites.length,
    cycleCount: normalizedHistory.cycles.length,
    frontierCount: normalizedHistory.frontier.length,
    classificationCounts: classificationCounts(dashboardRows),
    accounting: summarizeAccounting(normalizedHistory.cycles),
    dashboardRows,
  };
}
