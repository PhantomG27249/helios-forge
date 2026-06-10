function numericScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function replayScore(summary = {}) {
  const validationScore = numericScore(summary.validation?.score);
  const consistencyScore = numericScore(summary.consistency?.score);
  const validationPassRate = numericScore(summary.validation?.passRate);
  const metrics = summary.metrics ?? summary.aggregate?.metrics ?? {};
  const qualityScore = numericScore(metrics.quality) * 0.25;
  const safetyScore = numericScore(metrics.safety) * 0.25;
  const blockerPenalty = summary.validation?.passed === false || summary.consistency?.consistent === false ? 1 : 0;
  return validationScore + consistencyScore + validationPassRate + qualityScore + safetyScore - blockerPenalty;
}

function preferenceReasons({ baseline = {}, candidate = {} }) {
  const reasons = [];
  if (numericScore(candidate.validation?.score) > numericScore(baseline.validation?.score)) {
    reasons.push('candidate_validation');
  } else if (numericScore(baseline.validation?.score) > numericScore(candidate.validation?.score)) {
    reasons.push('baseline_validation');
  }

  if (numericScore(candidate.consistency?.score) > numericScore(baseline.consistency?.score)) {
    reasons.push('candidate_consistency');
  } else if (numericScore(baseline.consistency?.score) > numericScore(candidate.consistency?.score)) {
    reasons.push('baseline_consistency');
  }

  if (reasons.length === 0) {
    reasons.push('score_tie');
  }
  return reasons;
}

export function judgeSelfPreference({ baseline = {}, candidate = {} } = {}) {
  const baselineScore = replayScore(baseline);
  const candidateScore = replayScore(candidate);
  const scoreDelta = Number((candidateScore - baselineScore).toFixed(12));
  let preferred = 'tie';
  if (scoreDelta > 0) preferred = 'candidate';
  if (scoreDelta < 0) preferred = 'baseline';

  return {
    preferred,
    scoreDelta,
    baselineScore,
    candidateScore,
    reasons: preferenceReasons({ baseline, candidate }),
    promotionAllowed: false,
    authority: 'evidence_only',
    advisoryOnly: true,
  };
}
