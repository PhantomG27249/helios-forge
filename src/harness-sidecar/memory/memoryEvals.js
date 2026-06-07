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

export function scoreMemoryCorpus({ records = [] } = {}) {
  const evaluations = records.map((record) => evaluateMemoryRecord(record));
  const totalScore = evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0);

  return {
    totalRecords: records.length,
    averageScore: records.length === 0 ? 0 : Math.round(totalScore / records.length),
    promotableCount: evaluations.filter((evaluation) => evaluation.gate.status === 'promotable').length,
    quarantinedCount: evaluations.filter((evaluation) => evaluation.gate.status === 'quarantined').length,
    evaluations,
  };
}
