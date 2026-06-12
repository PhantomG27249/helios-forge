function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Math.round(finiteNumber(value) * 1000000) / 1000000;
}

function candidateIdOf(candidate, index) {
  return normalizeId(
    candidate?.candidateId ?? candidate?.policyId ?? candidate?.attemptId ?? candidate?.id,
    `candidate_${index + 1}`,
  );
}

function compatibleFamilyOf(record, fallback = 'lane') {
  return normalizeId(
    record?.compatibleFamily
      ?? record?.family
      ?? record?.metadata?.compatibleFamily
      ?? record?.metadata?.family,
    fallback,
  ).toLowerCase();
}

function goalCandidateIds(goal = {}) {
  return [
    goal.candidateId,
    goal.policyId,
    goal.attemptId,
    ...asArray(goal.candidateIds),
    ...asArray(goal.candidates),
  ].filter(Boolean).map(String);
}

function matchesGoal({ candidateId, candidateFamily, goal }) {
  const ids = goalCandidateIds(goal);
  if (ids.length > 0) return ids.includes(candidateId);
  const goalFamily = compatibleFamilyOf(goal, '');
  return Boolean(goalFamily) && goalFamily === candidateFamily;
}

function denseScoreFor(candidateId, denseScores = []) {
  return asArray(denseScores)
    .filter((score) => normalizeId(score?.candidateId ?? score?.id, '') === candidateId)
    .reduce((sum, score) => (
      sum + finiteNumber(score.score, 0) * finiteNumber(score.weight, 1)
    ), 0);
}

function adaptiveBoostFor(candidateId, adaptiveAction = {}) {
  if (!adaptiveAction || typeof adaptiveAction !== 'object') return 0;
  const selectedIds = [
    adaptiveAction.selectedCandidateId,
    adaptiveAction.candidateId,
    ...asArray(adaptiveAction.selectedCandidateIds),
  ].filter(Boolean).map(String);
  if (!selectedIds.includes(candidateId)) return 0;
  return finiteNumber(adaptiveAction.scoreBoost ?? adaptiveAction.boost ?? adaptiveAction.weight, 0.1);
}

function trajectoryFor(candidateId, trajectoryOperators = []) {
  return asArray(trajectoryOperators)
    .filter((operator) => {
      const ids = [
        operator?.candidateId,
        operator?.policyId,
        operator?.attemptId,
        ...asArray(operator?.candidateIds),
      ].filter(Boolean).map(String);
      return ids.length === 0 || ids.includes(candidateId);
    })
    .map((operator) => ({
      operator: normalizeId(operator.operator ?? operator.name, 'seed').toLowerCase(),
      operatorFamily: normalizeId(
        operator.operatorFamily ?? (
          ['crossover', 'recombination'].includes(String(operator.operator ?? '').toLowerCase())
            ? 'recombination'
            : 'mutation'
        ),
        'mutation',
      ).toLowerCase(),
      compatibleFamily: compatibleFamilyOf(operator),
      parents: [...new Set(asArray(operator.parents ?? operator.parentCandidateIds).filter(Boolean).map(String))],
      ...(operator.donorCandidateId ? { donorCandidateId: String(operator.donorCandidateId) } : {}),
      ...(operator.inputTrajectoryId ? { inputTrajectoryId: String(operator.inputTrajectoryId) } : {}),
      ...(operator.outputTrajectoryId ? { outputTrajectoryId: String(operator.outputTrajectoryId) } : {}),
    }));
}

function candidateScore({ candidate, candidateId, candidateFamily, backwardGoals, denseScores, adaptiveAction }) {
  const matchedGoals = asArray(backwardGoals).filter((goal) => (
    matchesGoal({ candidateId, candidateFamily, goal })
  ));
  const goalFamilies = new Set(asArray(backwardGoals)
    .map((goal) => compatibleFamilyOf(goal, ''))
    .filter(Boolean));
  const backwardGoalScore = matchedGoals.reduce((sum, goal) => sum + finiteNumber(goal.weight ?? goal.score, 1), 0);
  const familyCompatibilityScore = goalFamilies.size === 0 || goalFamilies.has(candidateFamily) ? 0 : -0.25;
  const denseScore = denseScoreFor(candidateId, denseScores);
  const adaptiveBoost = adaptiveBoostFor(candidateId, adaptiveAction);
  const forwardScore = finiteNumber(
    candidate.score ?? candidate.forwardScore ?? candidate.evidence?.domain?.score ?? candidate.evidence?.summary?.domainScore,
    0,
  );
  return {
    forwardScore: round(forwardScore),
    backwardGoalScore: round(backwardGoalScore),
    familyCompatibilityScore: round(familyCompatibilityScore),
    denseScore: round(denseScore),
    adaptiveBoost: round(adaptiveBoost),
    total: round(forwardScore + backwardGoalScore + familyCompatibilityScore + denseScore + adaptiveBoost),
    matchedGoals,
  };
}

export function fuseLiveBesLane({
  forwardCandidates,
  backwardGoals,
  denseScores,
  adaptiveAction,
  trajectoryOperators,
} = {}) {
  const candidates = asArray(forwardCandidates).map((candidate, index) => {
    const candidateId = candidateIdOf(candidate, index);
    const compatibleFamily = compatibleFamilyOf(candidate, candidate.lane ?? 'lane');
    const score = candidateScore({
      candidate,
      candidateId,
      candidateFamily: compatibleFamily,
      backwardGoals,
      denseScores,
      adaptiveAction,
    });
    const candidateTrajectoryOperators = trajectoryFor(candidateId, trajectoryOperators);
    return {
      candidateId,
      compatibleFamily,
      score: score.total,
      scoreBreakdown: {
        forwardScore: score.forwardScore,
        backwardGoalScore: score.backwardGoalScore,
        familyCompatibilityScore: score.familyCompatibilityScore,
        denseScore: score.denseScore,
        adaptiveBoost: score.adaptiveBoost,
      },
      matchedBackwardGoalIds: score.matchedGoals.map((goal, goalIndex) => (
        normalizeId(goal.goalId ?? goal.id, `goal_${goalIndex + 1}`)
      )),
      trajectoryOperators: candidateTrajectoryOperators,
      authority: 'evidence_only',
      canPromote: false,
    };
  }).sort((left, right) => (
    right.score - left.score
      || String(left.candidateId).localeCompare(String(right.candidateId))
  )).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));

  return {
    kind: 'live_bes_lane_fusion',
    evidenceOnly: true,
    promotionAllowed: false,
    promotionAuthority: false,
    orderedCandidateIds: candidates.map((candidate) => candidate.candidateId),
    compatibleFamilies: [...new Set(candidates.map((candidate) => candidate.compatibleFamily).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
    adaptiveAction: adaptiveAction && typeof adaptiveAction === 'object'
      ? {
        action: adaptiveAction.action ?? null,
        selectedCandidateId: adaptiveAction.selectedCandidateId ?? adaptiveAction.candidateId ?? null,
        trace: adaptiveAction.trace ?? null,
      }
      : null,
    candidates,
  };
}
