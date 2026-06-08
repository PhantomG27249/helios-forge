import { decideAutoApproval } from './autoApprovalPolicy.js';

function dominates(left, right) {
  const noWorse = (
    left.quality >= right.quality
    && left.safety >= right.safety
    && left.cost <= right.cost
    && left.latency <= right.latency
  );
  const betterSomewhere = (
    left.quality > right.quality
    || left.safety > right.safety
    || left.cost < right.cost
    || left.latency < right.latency
  );
  return noWorse && betterSomewhere;
}

function isApproved(candidateId, approvals) {
  return approvals.some((approval) => (
    approval.candidateId === candidateId && approval.choice === 'approve'
  ));
}

function isParetoImprovement(metrics, baselineFrontier) {
  if (!baselineFrontier.length) {
    return true;
  }
  const dominatedByBaseline = baselineFrontier.some((baseline) => dominates(baseline, metrics));
  const improvesBaseline = baselineFrontier.some((baseline) => dominates(metrics, baseline));
  return !dominatedByBaseline && improvesBaseline;
}

function isVerifierPolicyCandidate(candidateRun = {}) {
  return Boolean(
    candidateRun.target === 'verifier_policy'
      || candidateRun.verifierGenome
      || candidateRun.genome?.verifier
      || candidateRun.genomeId?.startsWith?.('vg_')
      || candidateRun.candidateId?.startsWith?.('vg_')
  );
}

function isShadowOnlyCandidate(candidateRun = {}) {
  return candidateRun.status === 'shadow_only' || candidateRun.directApplyAllowed === false;
}

function verifierHoldoutImproved(metrics = {}, baseline = {}) {
  if (!baseline || !Object.keys(baseline).length) return false;
  const reducedFalseNegatives = Number.isFinite(metrics.falseNegative) && Number.isFinite(baseline.falseNegative)
    ? metrics.falseNegative < baseline.falseNegative
    : false;
  const reducedFalsePositives = Number.isFinite(metrics.falsePositive) && Number.isFinite(baseline.falsePositive)
    ? metrics.falsePositive < baseline.falsePositive
    : false;
  const improvedRecall = Number.isFinite(metrics.recall) && Number.isFinite(baseline.recall)
    ? metrics.recall > baseline.recall
    : false;
  const improvedPrecision = Number.isFinite(metrics.precision) && Number.isFinite(baseline.precision)
    ? metrics.precision > baseline.precision
    : false;

  return reducedFalseNegatives || reducedFalsePositives || improvedRecall || improvedPrecision;
}

function verifierBaselineClean(candidateRun = {}, baselineResults = []) {
  if (candidateRun.safety?.passed === false || candidateRun.metrics?.safetyPassed === false) return false;
  return baselineResults.every((result = {}) => result.passed !== false);
}

function verifierCostAllowed({ metrics = {}, baseline = {}, approvals = [], verifierPolicy = {} }) {
  const candidateCost = Number(metrics.averageCost ?? metrics.cost);
  const baselineCost = Number(baseline.averageCost ?? baseline.cost);
  if (!Number.isFinite(candidateCost) || !Number.isFinite(baselineCost) || baselineCost <= 0) return true;
  const threshold = Number.isFinite(verifierPolicy.costIncreaseThreshold)
    ? verifierPolicy.costIncreaseThreshold
    : 0.1;
  const allowedCost = baselineCost * (1 + threshold);
  if (candidateCost <= allowedCost) return true;
  return approvals.some((approval = {}) => (
    approval.allowCostIncrease === true
      || approval.approveCostIncrease === true
      || approval.costOverride === true
  ));
}

function evaluateVerifierPromotion({
  candidateRun,
  baselineVerifierMetrics = {},
  baselineResults = [],
  approvals = [],
  verifierPolicy = {},
} = {}) {
  const candidateId = candidateRun?.candidateId;
  const metrics = candidateRun?.metrics || {};
  const reasons = [];

  if (isApproved(candidateId, approvals)) {
    reasons.push('human_approved');
  } else {
    reasons.push('missing_human_approval');
  }

  if (verifierHoldoutImproved(metrics, baselineVerifierMetrics)) {
    reasons.push('verifier_holdout_improved');
  } else {
    reasons.push('missing_verifier_holdout');
  }

  if (verifierBaselineClean(candidateRun, baselineResults)) {
    reasons.push('verifier_baseline_clean');
  } else {
    reasons.push('verifier_regression');
  }

  const flakinessThreshold = Number.isFinite(verifierPolicy.flakinessThreshold)
    ? verifierPolicy.flakinessThreshold
    : 0.2;
  if ((metrics.flakiness ?? 0) <= flakinessThreshold) {
    reasons.push('verifier_flakiness_ok');
  } else {
    reasons.push('verifier_flaky');
  }

  if (verifierCostAllowed({ metrics, baseline: baselineVerifierMetrics, approvals, verifierPolicy })) {
    reasons.push('verifier_cost_ok');
  } else {
    reasons.push('verifier_cost_regression');
  }

  const status = (
    reasons.includes('human_approved')
    && reasons.includes('verifier_holdout_improved')
    && reasons.includes('verifier_baseline_clean')
    && reasons.includes('verifier_flakiness_ok')
    && reasons.includes('verifier_cost_ok')
  ) ? 'promoted' : 'rejected';

  return {
    candidateId,
    status,
    reasons,
    metrics,
    baselineVerifierMetrics,
    verifierPolicy: {
      flakinessThreshold,
      costIncreaseThreshold: Number.isFinite(verifierPolicy.costIncreaseThreshold)
        ? verifierPolicy.costIncreaseThreshold
        : 0.1,
    },
  };
}

export function evaluatePromotion({
  candidateRun,
  baselineFrontier = [],
  baselineVerifierMetrics = {},
  baselineResults = [],
  approvals = [],
  safetyThreshold = 0.9,
  verifierPolicy = {},
  autoApproval = null,
} = {}) {
  if (isVerifierPolicyCandidate(candidateRun)) {
    return evaluateVerifierPromotion({
      candidateRun,
      baselineVerifierMetrics,
      baselineResults,
      approvals,
      verifierPolicy,
    });
  }

  const candidateId = candidateRun?.candidateId;
  const metrics = candidateRun?.metrics || {};
  const reasons = [];

  if (isApproved(candidateId, approvals)) {
    reasons.push('human_approved');
  } else {
    reasons.push('missing_human_approval');
  }

  if (candidateRun?.smokePassed) {
    reasons.push('smoke_passed');
  } else {
    reasons.push('smoke_failed');
  }

  if ((metrics.safety ?? 0) >= safetyThreshold) {
    reasons.push('safety_threshold_met');
  } else {
    reasons.push('safety_below_threshold');
  }

  if (isParetoImprovement(metrics, baselineFrontier)) {
    reasons.push('pareto_improvement');
  } else {
    reasons.push('not_pareto_improvement');
  }

  if (isShadowOnlyCandidate(candidateRun)) {
    reasons.push('shadow_policy_no_self_apply');
  }

  const status = (
    reasons.includes('human_approved')
    && reasons.includes('smoke_passed')
    && reasons.includes('safety_threshold_met')
    && reasons.includes('pareto_improvement')
    && !reasons.includes('shadow_policy_no_self_apply')
  ) ? 'promoted' : 'rejected';

  const result = {
    candidateId,
    status,
    reasons,
    metrics,
    safetyThreshold,
  };
  if (autoApproval) {
    result.autoApprovalEligibility = decideAutoApproval({
      candidate: candidateRun,
      evidence: autoApproval.evidence || {},
      rollback: autoApproval.rollback || null,
      trust: autoApproval.trust || {},
      approvals,
      policy: autoApproval.policy || {},
    });
  }
  return result;
}
