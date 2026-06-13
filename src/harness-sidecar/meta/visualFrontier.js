function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function uniqueSorted(values = []) {
  return [...new Set(asArray(values).filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function metricsFromReplay(replay = {}) {
  const metrics = replay.metrics || {};
  return {
    passRate: round(metrics.passRate),
    averageScore: round(metrics.averageScore),
    averageConfidence: round(metrics.averageConfidence),
    artifactCoverage: round(metrics.artifactCoverage),
    failedEvidenceCount: Number(metrics.failedEvidenceCount || 0),
  };
}

function frontierRecordFromReplay(replay = {}) {
  return {
    candidateId: replay.candidateId || replay.runId || 'visual-policy',
    replayRunId: replay.runId || null,
    suiteId: replay.suiteId || replay.suite?.suiteId || null,
    metrics: metricsFromReplay(replay),
    artifactHashes: uniqueSorted(replay.artifactHashes),
    authority: 'visual_evidence_only',
    canPromote: false,
  };
}

function normalizeRecord(record = {}) {
  return {
    candidateId: record.candidateId || 'visual-policy',
    replayRunId: record.replayRunId || record.runId || null,
    suiteId: record.suiteId || null,
    metrics: metricsFromReplay(record.metrics ? { metrics: record.metrics } : record),
    artifactHashes: uniqueSorted(record.artifactHashes),
    authority: 'visual_evidence_only',
    canPromote: false,
  };
}

function rankRecords(records = []) {
  return [...records].sort((left, right) => (
    Number(right.metrics?.passRate || 0) - Number(left.metrics?.passRate || 0)
      || Number(right.metrics?.averageScore || 0) - Number(left.metrics?.averageScore || 0)
      || Number(right.metrics?.artifactCoverage || 0) - Number(left.metrics?.artifactCoverage || 0)
      || String(left.candidateId || '').localeCompare(String(right.candidateId || ''))
  ));
}

export function buildVisualFrontierHardCases({ replay } = {}) {
  return {
    rhoCases: asArray(replay?.rhoHardCases).map((entry) => ({
      ...entry,
      evidence: {
        ...(entry.evidence || {}),
        authority: 'evidence_only',
        canPromote: false,
      },
      visualEvidenceRequired: true,
      canPromote: false,
    })),
    besHardCases: asArray(replay?.besHardCases).map((entry) => ({
      ...entry,
      source: 'visual_frontier_failed_evidence',
      visualEvidenceRequired: true,
      canPromote: false,
    })),
  };
}

export function updateVisualFrontier({ history = {}, replay } = {}) {
  const existingRecords = asArray(history.records).map(normalizeRecord);
  const replayRecord = replay ? frontierRecordFromReplay(replay) : null;
  const records = rankRecords(replayRecord ? [replayRecord, ...existingRecords] : existingRecords);
  const hardCases = buildVisualFrontierHardCases({ replay });

  return {
    schemaVersion: 1,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    records,
    promotionCandidates: asArray(replay?.promotionCandidates).map((entry) => ({
      ...entry,
      visualEvidenceRequired: true,
      evidenceOnly: true,
      canPromote: false,
    })),
    hardCases,
  };
}

function dashboardRows(frontier = {}) {
  return asArray(frontier.records).map((record) => ({
    candidateId: record.candidateId || null,
    replayRunId: record.replayRunId || null,
    suiteId: record.suiteId || null,
    classification: 'frontier',
    metrics: metricsFromReplay({ metrics: record.metrics }),
    dashboardText: '',
    authority: 'visual_evidence_only',
    canPromote: false,
  }));
}

function classificationCounts(rows = []) {
  const blocked = rows.filter((row) => Number(row.metrics?.failedEvidenceCount || 0) > 0).length;
  return {
    frontier: rows.length,
    blocked,
  };
}

export function summarizeVisualFrontier(frontier = {}) {
  const rows = dashboardRows(frontier);
  return {
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    recordCount: asArray(frontier.records).length,
    dashboardRows: rows,
    classificationCounts: classificationCounts(rows),
  };
}
