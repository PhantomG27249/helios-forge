const DEFAULT_TARGET_OPTIMIZERS = Object.freeze([
  'rho',
  'bes',
  'meta',
  'router',
  'visual',
  'memory',
]);

function safeIdPart(value) {
  return String(value || 'optimizer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'optimizer';
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMetric(value) {
  return Number(finiteNumber(value).toFixed(6));
}

function sourceEvidenceIds(record = {}, targetOptimizer) {
  const ids = [
    record.evidenceId,
    record.runId,
    record.traceId,
    ...(Array.isArray(record.sourceEvidenceIds) ? record.sourceEvidenceIds : []),
  ].filter(Boolean);
  return ids.length ? [...new Set(ids)] : [`${targetOptimizer}_evidence_unavailable`];
}

function evidenceFingerprint({ parentId, targetOptimizer, sourceEvidenceIds: ids, metrics }) {
  return [
    parentId,
    targetOptimizer,
    ...ids,
    metrics.quality,
    metrics.safety,
    metrics.cost,
    metrics.latency,
    metrics.coverage,
  ].join('|');
}

function stableFingerprintId(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function metricInputs(record = {}) {
  return Object.freeze({
    heldoutPassRate: finiteNumber(record.heldoutPassRate),
    baselinePassRate: finiteNumber(record.baselinePassRate),
    safetyScore: finiteNumber(record.safetyScore),
    averageCost: finiteNumber(record.averageCost),
    latencyMs: finiteNumber(record.latencyMs),
    coverage: finiteNumber(record.coverage),
  });
}

function paretoMetricsFor(targetOptimizer, inputs) {
  return Object.freeze({
    targetOptimizer,
    quality: roundMetric(inputs.heldoutPassRate - inputs.baselinePassRate),
    safety: roundMetric(inputs.safetyScore),
    cost: roundMetric(inputs.averageCost),
    latency: roundMetric(inputs.latencyMs / 1000),
    coverage: roundMetric(inputs.coverage),
  });
}

function selfApprovalEvidence(selfApprovalAttempt, parentOptimizerId, parentId) {
  const attemptedOptimizerId = String(selfApprovalAttempt?.optimizerId || '');
  if (
    !selfApprovalAttempt
    || (
      attemptedOptimizerId !== String(parentOptimizerId)
      && safeIdPart(attemptedOptimizerId) !== parentId
    )
  ) {
    return Object.freeze({
      attempted: false,
      blocked: false,
    });
  }

  return Object.freeze({
    attempted: true,
    blocked: true,
    reason: 'optimizer_self_approval_blocked',
    optimizerId: parentOptimizerId,
  });
}

function freezeCandidate(candidate) {
  return Object.freeze({
    ...candidate,
    evidence: Object.freeze(candidate.evidence),
    paretoMetrics: Object.freeze(candidate.paretoMetrics),
  });
}

export class HarnessOfHarnessesOptimizer {
  constructor({
    now = () => new Date(),
    idPrefix = 'hoh',
    defaultTargets = DEFAULT_TARGET_OPTIMIZERS,
  } = {}) {
    this.now = now;
    this.idPrefix = idPrefix;
    this.defaultTargets = [...defaultTargets];
  }

  proposeEvidence({
    parentOptimizerId = 'parent_optimizer',
    targets = this.defaultTargets,
    evidenceByTarget = {},
    selfApprovalAttempt = null,
  } = {}) {
    const parentId = safeIdPart(parentOptimizerId);
    const candidates = targets.map((targetOptimizer, index) => {
      const normalizedTarget = safeIdPart(targetOptimizer);
      const record = evidenceByTarget[targetOptimizer] || evidenceByTarget[normalizedTarget] || {};
      const inputs = metricInputs(record);
      const paretoMetrics = paretoMetricsFor(normalizedTarget, inputs);
      const sourceIds = Object.freeze(sourceEvidenceIds(record, normalizedTarget));
      const fingerprint = stableFingerprintId(evidenceFingerprint({
        parentId,
        targetOptimizer: normalizedTarget,
        sourceEvidenceIds: sourceIds,
        metrics: paretoMetrics,
      }));
      const candidate = {
        optimizerCandidateId: `${safeIdPart(this.idPrefix)}_${parentId}_${normalizedTarget}_${fingerprint}_${String(index + 1).padStart(3, '0')}`,
        parentOptimizerId,
        targetOptimizer: normalizedTarget,
        evidence: {
          kind: 'harness_of_harnesses_optimizer_evidence',
          parentOptimizerId,
          targetOptimizer: normalizedTarget,
          sourceEvidenceIds: sourceIds,
          metricInputs: inputs,
          selfApproval: selfApprovalEvidence(selfApprovalAttempt, parentOptimizerId, parentId),
        },
        paretoMetrics,
        evidenceOnly: true,
        canPromote: false,
      };
      return freezeCandidate(candidate);
    });

    return Object.freeze({
      parentOptimizerId,
      candidates: Object.freeze(candidates),
      evidenceOnly: true,
      canPromote: false,
    });
  }
}

export function createHarnessOfHarnessesOptimizer(options = {}) {
  return new HarnessOfHarnessesOptimizer(options);
}
