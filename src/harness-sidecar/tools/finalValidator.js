export function evaluateFinalValidation({
  verifierResults = [],
  requiredArtifacts = [],
  approvals = [],
}) {
  const reasons = [];
  if (!verifierResults.length || verifierResults.some((result) => result.passed === false)) {
    reasons.push('verifier_failed');
  }
  if (!requiredArtifacts.length) {
    reasons.push('missing_artifacts');
  }
  if (!approvals.some((approval) => approval.choice === 'approve')) {
    reasons.push('missing_approval');
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
