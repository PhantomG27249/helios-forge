function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function evidenceForAttempt(attempt = {}) {
  return attempt.verifierEvidence || attempt.output?.verifierEvidence || [];
}

function patchForAttempt(attempt = {}) {
  return attempt.output?.patch || attempt.patch || '';
}

function changedLinesForAttempt(attempt = {}) {
  if (Number.isFinite(attempt.patchStats?.changedLines)) return attempt.patchStats.changedLines;
  if (Number.isFinite(attempt.output?.patchStats?.changedLines)) return attempt.output.patchStats.changedLines;
  return patchForAttempt(attempt)
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
}

export function reviewAttempt({
  attempt = {},
  riskPolicy = {},
} = {}) {
  const maxChangedLines = riskPolicy.maxChangedLines ?? 150;
  const forbiddenPaths = riskPolicy.forbiddenPaths || [];
  const verifierEvidence = evidenceForAttempt(attempt);
  const patch = patchForAttempt(attempt);
  const changedLines = changedLinesForAttempt(attempt);
  const reasons = [];

  if (!verifierEvidence.length) reasons.push('missing_verifier_evidence');
  if (attempt.status === 'contract_failed' || attempt.contract?.valid === false) {
    reasons.push('output_contract_failed');
  }
  if (changedLines > maxChangedLines) reasons.push('patch_too_large');
  if (forbiddenPaths.some((filePath) => patch.includes(filePath))) {
    reasons.push('forbidden_path_touched');
  }

  return {
    attemptId: attempt.attemptId,
    approved: reasons.length === 0,
    reasons: unique(reasons),
    score: attempt.score || attempt.output?.score || 0,
    output: attempt.output || {},
    verifierEvidence,
    patchStats: {
      changedLines,
    },
  };
}
