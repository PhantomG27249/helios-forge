function numericScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function replayScore(summary = {}) {
  return numericScore(summary.validation?.score) + numericScore(summary.consistency?.score);
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
  };
}
