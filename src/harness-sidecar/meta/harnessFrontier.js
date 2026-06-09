import { sanitizeCandidateId } from './frontierStore.js';

const HIGHER_IS_BETTER = ['quality', 'safety'];
const LOWER_IS_BETTER = ['cost', 'latency'];

function numericMetric(metrics = {}, key, fallback) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizedMetrics(metrics = {}) {
  return {
    quality: numericMetric(metrics, 'quality', 0),
    safety: numericMetric(metrics, 'safety', 0),
    cost: numericMetric(metrics, 'cost', Number.POSITIVE_INFINITY),
    latency: numericMetric(metrics, 'latency', Number.POSITIVE_INFINITY),
  };
}

function metricRecord(candidate = {}) {
  const metrics = normalizedMetrics(candidate.metrics || candidate);
  return {
    ...candidate,
    candidateId: sanitizeCandidateId(candidate.candidateId),
    metrics,
  };
}

export function harnessMetricsDominate(left = {}, right = {}) {
  const leftMetrics = normalizedMetrics(left.metrics || left);
  const rightMetrics = normalizedMetrics(right.metrics || right);

  const noWorse = HIGHER_IS_BETTER.every((key) => leftMetrics[key] >= rightMetrics[key])
    && LOWER_IS_BETTER.every((key) => leftMetrics[key] <= rightMetrics[key]);
  const betterSomewhere = HIGHER_IS_BETTER.some((key) => leftMetrics[key] > rightMetrics[key])
    || LOWER_IS_BETTER.some((key) => leftMetrics[key] < rightMetrics[key]);

  return noWorse && betterSomewhere;
}

export function evaluateHarnessFrontierCandidate({ current = [], candidate = {} } = {}) {
  const candidateRecord = metricRecord(candidate);
  const frontier = current.map(metricRecord);
  const dominator = frontier.find((entry) => harnessMetricsDominate(entry, candidateRecord));

  if (dominator) {
    return {
      accepted: false,
      reasons: ['candidate_dominated'],
      dominatedBy: dominator.candidateId,
      frontier,
    };
  }

  return {
    accepted: true,
    reasons: ['non_dominated'],
    removed: frontier
      .filter((entry) => harnessMetricsDominate(candidateRecord, entry))
      .map((entry) => entry.candidateId),
    frontier: [...frontier.filter((entry) => !harnessMetricsDominate(candidateRecord, entry)), candidateRecord],
  };
}

export function updateHarnessFrontier({ current = [], candidate = {} } = {}) {
  const decision = evaluateHarnessFrontierCandidate({ current, candidate });
  return decision.frontier.sort((left, right) => (
    right.metrics.safety - left.metrics.safety
      || right.metrics.quality - left.metrics.quality
      || left.metrics.cost - right.metrics.cost
      || left.metrics.latency - right.metrics.latency
      || String(left.candidateId).localeCompare(String(right.candidateId))
  ));
}
