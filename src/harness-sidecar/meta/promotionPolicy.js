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

export function evaluatePromotion({
  candidateRun,
  baselineFrontier = [],
  approvals = [],
  safetyThreshold = 0.9,
} = {}) {
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

  const status = (
    reasons.includes('human_approved')
    && reasons.includes('smoke_passed')
    && reasons.includes('safety_threshold_met')
    && reasons.includes('pareto_improvement')
  ) ? 'promoted' : 'rejected';

  return {
    candidateId,
    status,
    reasons,
    metrics,
    safetyThreshold,
  };
}
