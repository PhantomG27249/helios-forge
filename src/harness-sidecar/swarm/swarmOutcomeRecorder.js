function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function reviewForAttempt(reviews = [], attemptId) {
  return reviews.find((review) => review?.attemptId === attemptId) || {};
}

function hasVisualSignal(attempt = {}, review = {}) {
  const text = [
    attempt.profile?.id,
    attempt.profile?.role,
    attempt.specialization,
    attempt.failure?.reason,
    ...asArray(attempt.risks),
    ...asArray(review.reasons),
    ...asArray(attempt.tags),
  ].join(' ').toLowerCase();
  return Boolean(
    text.includes('visual') ||
      text.includes('vlm') ||
      asArray(attempt.artifacts).some((artifact) => {
        const artifactText = [artifact?.kind, artifact?.type, artifact?.path].join(' ').toLowerCase();
        return artifactText.includes('visual') || artifactText.includes('vlm') || artifactText.includes('screenshot');
      }),
  );
}

function hardCaseReason({ attempt = {}, review = {} } = {}) {
  const reviewReasons = asArray(review.reasons);
  if (
    reviewReasons.includes('unsafe_patch') ||
    reviewReasons.includes('forbidden_path_touched') ||
    reviewReasons.includes('patch_too_large') ||
    attempt.safety === 'unsafe' ||
    asArray(attempt.risks).length > 0
  ) {
    return 'swarm_unsafe_patch';
  }
  if (hasVisualSignal(attempt, review)) {
    return 'swarm_visual_failure';
  }
  if (reviewReasons.includes('missing_verifier_evidence') || asArray(attempt.verifierEvidence).length === 0) {
    return 'swarm_missing_verifier_evidence';
  }
  if (reviewReasons.includes('champion_regression') || attempt.failure?.reason === 'champion_regression') {
    return 'swarm_champion_regression';
  }
  return null;
}

function hardCaseFromAttempt({ taskId, attempt, review }) {
  const reason = hardCaseReason({ attempt, review });
  if (!reason) return null;
  return {
    taskId: `${taskId}:${attempt.attemptId}`,
    source: 'swarm_outcome',
    status: attempt.status === 'failed' ? 'failed' : 'unsuccessful',
    success: false,
    failureModes: [reason],
    swarm: {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      profileId: attempt.profile?.id,
      reviewReasons: asArray(review.reasons),
      failure: attempt.failure,
      verifierEvidenceCount: asArray(attempt.verifierEvidence).length,
    },
    visual: reason === 'swarm_visual_failure',
  };
}

export function summarizeSwarmOutcome({
  taskId = 'task_swarm',
  attempts = [],
  reviews = [],
  champion = null,
  recombination = null,
} = {}) {
  const positiveSignals = [];
  const hardCases = [];
  const visualCases = [];

  if (champion?.attemptId && champion.verifierPassed !== false) {
    positiveSignals.push({
      taskId,
      attemptId: champion.attemptId,
      reason: 'swarm_champion_success',
      score: champion.score || 0,
      verifierEvidenceCount: asArray(champion.verifierEvidence).length,
    });
  }

  for (const attempt of attempts) {
    const review = reviewForAttempt(reviews, attempt.attemptId);
    const rejected = review.approved === false || attempt.status === 'failed' || attempt.verifierPassed === false;
    if (rejected) {
      const hardCase = hardCaseFromAttempt({ taskId, attempt, review });
      if (hardCase) hardCases.push(hardCase);
    }
    if (hasVisualSignal(attempt, review)) {
      visualCases.push({
        taskId,
        attemptId: attempt.attemptId,
        artifacts: asArray(attempt.artifacts),
        profileId: attempt.profile?.id,
        failure: attempt.failure,
      });
    }
  }

  const recombinationWin = Boolean(
    recombination?.sourceAttemptIds?.length &&
      champion?.attemptId &&
      recombination.sourceAttemptIds.includes(champion.attemptId),
  );
  const metaCandidates = positiveSignals.length || recombinationWin
    ? [{
      taskId,
      source: 'swarm_outcome',
      failureModes: ['swarm_recombination_win'],
      positiveAttemptIds: positiveSignals.map((signal) => signal.attemptId),
      recombination,
    }]
    : [];

  return {
    taskId,
    positiveSignals,
    hardCases,
    failureModes: unique(hardCases.flatMap((item) => item.failureModes)),
    visualCases,
    metaCandidates,
  };
}
