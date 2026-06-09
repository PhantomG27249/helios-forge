function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasPassedVerifierEvidence(rollout = {}) {
  return asArray(rollout.verifierEvidence ?? rollout.verifier_evidence)
    .some((entry) => entry === true || entry?.passed === true || entry?.status === 'passed');
}

function hasTestEvidence(rollout = {}) {
  const testsRun = asArray(rollout.compactHandoff?.testsRun ?? rollout.testsRun ?? rollout.tests_run);
  const testEvidence = asArray(rollout.testEvidence ?? rollout.test_evidence);
  if ([...testsRun, ...testEvidence].some((entry) => entry?.passed === false || entry?.status === 'failed')) {
    return false;
  }
  return Boolean(
    testsRun.some((entry) => typeof entry === 'string' || entry === true || entry?.passed === true || entry?.status === 'passed')
      || testEvidence.some((entry) => entry === true || entry?.passed === true || entry?.status === 'passed')
  );
}

function hasFailedTestEvidence(rollout = {}) {
  const testsRun = asArray(rollout.compactHandoff?.testsRun ?? rollout.testsRun ?? rollout.tests_run);
  const testEvidence = asArray(rollout.testEvidence ?? rollout.test_evidence);
  return [...testsRun, ...testEvidence].some((entry) => entry?.passed === false || entry?.status === 'failed');
}

export function scoreSelfValidation(rollout = {}) {
  const completed = rollout.status === 'completed' || rollout.completed === true;
  const verifierPassed = hasPassedVerifierEvidence(rollout);
  const testsObserved = hasTestEvidence(rollout);
  const reasons = [];

  if (!completed) {
    reasons.push('not_completed');
    return { passed: false, score: 0, reason: 'not_completed', reasons };
  }
  if (verifierPassed) {
    reasons.push('verifier_passed');
    return { passed: true, score: 1, reason: 'verifier_passed', reasons };
  }
  if (hasFailedTestEvidence(rollout)) {
    reasons.push('tests_failed');
    return { passed: false, score: 0, reason: 'tests_failed', reasons };
  }
  if (testsObserved) {
    reasons.push('tests_observed');
    return { passed: true, score: 1, reason: 'tests_observed', reasons };
  }

  reasons.push('missing_validation_evidence');
  return { passed: false, score: 0, reason: 'missing_validation_evidence', reasons };
}
