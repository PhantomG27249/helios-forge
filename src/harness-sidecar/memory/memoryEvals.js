import { decideReflectionGate } from './reflectionGate.js';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateMemoryRecord(record = {}) {
  const checks = {
    hasType: hasText(record.type),
    hasSummary: hasText(record.summary),
    hasEvidence: Array.isArray(record.evidence) && record.evidence.length > 0,
    reviewed: record.reviewStatus === 'reviewed' || record.reviewStatus === 'approved',
    validatorBacked: record.validatorBacked === true,
  };

  const score = Object.values(checks).filter(Boolean).length * 20;
  const gate = decideReflectionGate(record);

  return {
    record,
    score,
    checks,
    gate,
  };
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function expectedFactRecords(records = []) {
  return records.filter((record) => Object.hasOwn(record, 'expectedObject'));
}

function conflictQuality(conflicts = []) {
  const items = normalizeList(conflicts).filter((conflict) => conflict.correctAction);
  return percent(items.filter((conflict) => conflict.action === conflict.correctAction).length, items.length);
}

function activeFactPrecision(records = []) {
  const active = expectedFactRecords(records).filter((record) => record.status === 'active');
  return percent(active.filter((record) => record.object === record.expectedObject).length, active.length);
}

function evidenceCoverage(records = []) {
  return percent(
    records.filter((record) => normalizeList(record.evidence).length > 0).length,
    records.length,
  );
}

function provenanceCoverage(records = []) {
  return percent(
    records.filter((record) => {
      return normalizeList(record.provenance).length > 0
        || normalizeList(record.provenanceRefs).length > 0;
    }).length,
    records.length,
  );
}

function graphConnectivity(graph = {}) {
  const nodes = normalizeList(graph.nodes);
  const edges = normalizeList(graph.edges);
  return percent(Math.min(edges.length, nodes.length), nodes.length);
}

function retrievalHitRate(retrievalResults = []) {
  const results = normalizeList(retrievalResults);
  const hits = results.filter((result) => {
    const expected = new Set(normalizeList(result.expectedIds).map(String));
    const retrieved = new Set(normalizeList(result.retrievedIds).map(String));
    return [...expected].some((id) => retrieved.has(id));
  });
  return percent(hits.length, results.length);
}

function budgetEfficiency({ retrievalResults = [], budget = {} } = {}) {
  const tokenBudget = Number(budget.tokenBudget ?? budget.maxTokens);
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) return 0;
  const used = normalizeList(retrievalResults).reduce((sum, result) => sum + (Number(result.tokensEstimated) || 0), 0);
  return Math.max(0, Math.min(100, Math.round((used / tokenBudget) * 100)));
}

function hasEvidence(value = {}) {
  return normalizeList(value.evidence).length > 0;
}

function migrationHealth(migrations = []) {
  const items = normalizeList(migrations);
  const healthy = items.filter((migration) => {
    const status = String(migration.status || '').toLowerCase();
    const complete = ['complete', 'completed', 'success', 'succeeded'].includes(status);
    const failedRecords = Number(migration.failedRecords ?? migration.failures ?? 0);
    return complete && hasEvidence(migration) && failedRecords === 0 && migration.dataLoss !== true;
  });
  return percent(healthy.length, items.length);
}

function decayItemHealthy(item = {}) {
  const status = String(item.status || '').toLowerCase();
  const action = String(item.action || '').toLowerCase();
  if (['fresh', 'active', 'retained'].includes(status)) return hasEvidence(item);
  if (['stale', 'decayed', 'expired'].includes(status)) {
    return ['quarantined', 'consolidated', 'superseded', 'archived', 'removed'].includes(action) && hasEvidence(item);
  }
  return ['resolved', 'complete', 'completed'].includes(status) && hasEvidence(item);
}

function consolidationItemHealthy(item = {}) {
  const status = String(item.status || '').toLowerCase();
  return ['resolved', 'complete', 'completed', 'consolidated'].includes(status) && hasEvidence(item);
}

function decayConsolidationHealth({ decay = [], consolidation = [] } = {}) {
  const decayItems = normalizeList(decay);
  const consolidationItems = normalizeList(consolidation);
  const total = decayItems.length + consolidationItems.length;
  const healthy = decayItems.filter(decayItemHealthy).length
    + consolidationItems.filter(consolidationItemHealthy).length;
  return percent(healthy, total);
}

function visualEvidenceCoverage(records = []) {
  return percent(
    records.filter((record) => {
      const modalities = normalizeList(record.evidenceModalities).map((modality) => String(modality).toLowerCase());
      const evidence = normalizeList(record.evidence).map((item) => String(item).toLowerCase());
      return normalizeList(record.visualEvidence).length > 0
        || modalities.includes('visual')
        || evidence.some((item) => item.includes('screenshot') || item.endsWith('.png') || item.endsWith('.jpg') || item.endsWith('.jpeg') || item.endsWith('.webp'));
    }).length,
    records.length,
  );
}

export function scoreMemoryCorpus({
  records = [],
  conflicts = [],
  retrievalResults = [],
  graph = {},
  budget = {},
  migrations = [],
  decay = [],
  consolidation = [],
} = {}) {
  const evaluations = records.map((record) => evaluateMemoryRecord(record));
  const totalScore = evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0);

  return {
    evidenceOnly: true,
    canPromote: false,
    totalRecords: records.length,
    averageScore: records.length === 0 ? 0 : Math.round(totalScore / records.length),
    promotableCount: evaluations.filter((evaluation) => evaluation.gate.status === 'promotable').length,
    quarantinedCount: evaluations.filter((evaluation) => evaluation.gate.status === 'quarantined').length,
    metrics: {
      conflictQuality: conflictQuality(conflicts),
      activeFactPrecision: activeFactPrecision(records),
      evidenceCoverage: evidenceCoverage(records),
      provenanceCoverage: provenanceCoverage(records),
      connectivity: graphConnectivity(graph),
      retrievalHitRate: retrievalHitRate(retrievalResults),
      budgetEfficiency: budgetEfficiency({ retrievalResults, budget }),
      migrationHealth: migrationHealth(migrations),
      decayConsolidationHealth: decayConsolidationHealth({ decay, consolidation }),
      visualEvidenceCoverage: visualEvidenceCoverage(records),
    },
    evaluations,
  };
}
