import { sanitizeCandidateId } from './frontierStore.js';
import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function metricNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeMetrics(report = {}) {
  const summary = report.summary || report.metrics || {};
  return {
    averageScore: round(metricNumber(summary.averageScore)),
    averageConfidence: round(metricNumber(summary.averageConfidence)),
    failedEvidenceCount: Math.max(0, Math.floor(metricNumber(summary.failedEvidenceCount))),
    passedEvidenceCount: Math.max(0, Math.floor(metricNumber(summary.passedEvidenceCount))),
    caseCount: Math.max(0, Math.floor(metricNumber(summary.caseCount))),
    byKind: report.metrics?.byKind || {},
  };
}

function normalizeEntry({ replayReport = {}, now = () => new Date() }) {
  const hardCases = asArray(replayReport.hardCases).map((hardCase) => quarantineModelVisiblePayload({
    ...hardCase,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  }).value);
  return {
    suiteId: sanitizeCandidateId(replayReport.suiteId || 'visual-suite'),
    candidateId: sanitizeCandidateId(replayReport.candidateId || 'candidate'),
    recordedAt: replayReport.recordedAt || now().toISOString(),
    metrics: normalizeMetrics(replayReport),
    hardCases,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  };
}

function dominates(left = {}, right = {}) {
  const leftMetrics = normalizeMetrics(left);
  const rightMetrics = normalizeMetrics(right);
  const noWorse = leftMetrics.averageScore >= rightMetrics.averageScore
    && leftMetrics.averageConfidence >= rightMetrics.averageConfidence
    && leftMetrics.failedEvidenceCount <= rightMetrics.failedEvidenceCount;
  const better = leftMetrics.averageScore > rightMetrics.averageScore
    || leftMetrics.averageConfidence > rightMetrics.averageConfidence
    || leftMetrics.failedEvidenceCount < rightMetrics.failedEvidenceCount;
  return noWorse && better;
}

export function updateVisualFrontier({
  frontier = [],
  replayReport = {},
  now = () => new Date(),
} = {}) {
  const candidate = normalizeEntry({ replayReport, now });
  const current = asArray(frontier)
    .map((entry) => ({
      ...entry,
      candidateId: sanitizeCandidateId(entry.candidateId),
      suiteId: sanitizeCandidateId(entry.suiteId || candidate.suiteId),
      metrics: normalizeMetrics(entry),
      visualEvidenceRequired: true,
      evidenceOnly: true,
      canPromote: false,
    }))
    .filter((entry) => entry.candidateId !== candidate.candidateId);

  if (current.some((entry) => dominates(entry, candidate))) return current;

  return [
    ...current.filter((entry) => !dominates(candidate, entry)),
    candidate,
  ].sort((left, right) => (
    right.metrics.averageScore - left.metrics.averageScore
      || right.metrics.averageConfidence - left.metrics.averageConfidence
      || left.metrics.failedEvidenceCount - right.metrics.failedEvidenceCount
      || String(left.candidateId).localeCompare(String(right.candidateId))
  ));
}

export function summarizeVisualFrontier(frontier = []) {
  const normalized = asArray(frontier).map((entry) => ({
    ...entry,
    candidateId: sanitizeCandidateId(entry.candidateId),
    metrics: normalizeMetrics(entry),
    hardCases: asArray(entry.hardCases).map((hardCase) => quarantineModelVisiblePayload({
      ...hardCase,
      visualEvidenceRequired: true,
      evidenceOnly: true,
      canPromote: false,
    }).value),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  }));
  const best = normalized[0] || null;
  return {
    schemaVersion: 1,
    frontierCount: normalized.length,
    bestCandidateId: best?.candidateId || null,
    averageScore: round(normalized.reduce((sum, entry) => sum + entry.metrics.averageScore, 0) / Math.max(1, normalized.length)),
    failedEvidenceCount: normalized.reduce((sum, entry) => sum + entry.metrics.failedEvidenceCount, 0),
    hardCaseCount: normalized.reduce((sum, entry) => sum + asArray(entry.hardCases).length, 0),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    frontier: normalized,
  };
}
