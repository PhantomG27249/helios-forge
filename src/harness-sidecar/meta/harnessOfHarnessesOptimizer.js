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

function timestampPart(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString().replace(/[-:.]/g, '').toLowerCase();
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

function selfApprovalEvidence(selfApprovalAttempt, parentOptimizerId) {
  if (!selfApprovalAttempt || selfApprovalAttempt.optimizerId !== parentOptimizerId) {
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
    const stamp = timestampPart(this.now);
    const candidates = targets.map((targetOptimizer, index) => {
      const normalizedTarget = safeIdPart(targetOptimizer);
      const record = evidenceByTarget[targetOptimizer] || evidenceByTarget[normalizedTarget] || {};
      const inputs = metricInputs(record);
      const candidate = {
        optimizerCandidateId: `${safeIdPart(this.idPrefix)}_${parentId}_${normalizedTarget}_${stamp}_${String(index + 1).padStart(3, '0')}`,
        parentOptimizerId,
        targetOptimizer: normalizedTarget,
        evidence: {
          kind: 'harness_of_harnesses_optimizer_evidence',
          parentOptimizerId,
          targetOptimizer: normalizedTarget,
          sourceEvidenceIds: Object.freeze(sourceEvidenceIds(record, normalizedTarget)),
          metricInputs: inputs,
          selfApproval: selfApprovalEvidence(selfApprovalAttempt, parentOptimizerId),
        },
        paretoMetrics: paretoMetricsFor(normalizedTarget, inputs),
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
