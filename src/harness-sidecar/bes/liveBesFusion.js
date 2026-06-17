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

const BES_JUDGMENT_GATE = 'modelAssistedBesJudgment';

function normalizeNow(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function resolveBesJudgmentGate(input = {}) {
  const gate = input.gate
    ?? input.featureGate
    ?? input.productionCapabilities?.[BES_JUDGMENT_GATE]
    ?? { enabled: false, mode: 'offline', authority: 'evidence_only' };
  return {
    name: BES_JUDGMENT_GATE,
    enabled: gate.enabled === true,
    mode: gate.mode ?? 'offline',
    authority: 'evidence_only',
  };
}

function fusionWeightsFrom(input = {}) {
  const weights = input.fusionWeights ?? input.laneOrderingWeights ?? {};
  return {
    forward: finiteNumber(weights.forward ?? input.forwardWeight, 1),
    backward: finiteNumber(weights.backward ?? input.backwardWeight, 1),
    dense: finiteNumber(weights.dense ?? input.denseWeight, 1),
    adaptive: finiteNumber(weights.adaptive ?? input.adaptiveWeight, 1),
  };
}

function dominantSignalFor(breakdown = {}, weights = {}) {
  const contributions = {
    forward: finiteNumber(breakdown.forwardScore) * finiteNumber(weights.forward, 1),
    backward: finiteNumber(breakdown.backwardGoalScore) * finiteNumber(weights.backward, 1),
    dense: finiteNumber(breakdown.denseScore) * finiteNumber(weights.dense, 1),
    adaptive: finiteNumber(breakdown.adaptiveBoost) * finiteNumber(weights.adaptive, 1),
  };
  const ranked = Object.entries(contributions).sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? 'forward';
}

function orderingRationaleFor(fusion = {}, weights = {}) {
  const rankDecisions = asArray(fusion.candidates).map((candidate, index) => {
    const breakdown = candidate.scoreBreakdown ?? {};
    const weightedContributions = {
      forward: round(finiteNumber(breakdown.forwardScore) * finiteNumber(weights.forward, 1)),
      backward: round(finiteNumber(breakdown.backwardGoalScore) * finiteNumber(weights.backward, 1)),
      dense: round(finiteNumber(breakdown.denseScore) * finiteNumber(weights.dense, 1)),
      adaptive: round(finiteNumber(breakdown.adaptiveBoost) * finiteNumber(weights.adaptive, 1)),
      familyCompatibility: round(breakdown.familyCompatibilityScore ?? 0),
    };
    return {
      candidateId: candidate.candidateId,
      rank: candidate.rank ?? index + 1,
      score: candidate.score,
      weightedContributions,
      dominantSignal: dominantSignalFor(breakdown, weights),
      ...(index > 0 ? {
        aheadOf: fusion.candidates[index - 1]?.candidateId ?? null,
        separationFromPrior: round(
          finiteNumber(fusion.candidates[index - 1]?.score) - finiteNumber(candidate.score),
        ),
      } : {}),
    };
  });

  return {
    summary: 'live_bes_forward_backward_fusion',
    rankDecisions,
  };
}

function evidenceOnlyFusion(fusion = {}) {
  Object.assign(fusion, {
    evidenceOnly: true,
    promotionAllowed: false,
    promotionAuthority: false,
    promotionEvidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  });
  fusion.candidates = asArray(fusion.candidates).map((candidate) => ({
    ...candidate,
    authority: 'evidence_only',
    canPromote: false,
  }));
  return fusion;
}

function fuseInputFrom(input = {}) {
  const {
    fusion,
    gate,
    featureGate,
    productionCapabilities,
    lane,
    taskId,
    now,
    fusionWeights,
    laneOrderingWeights,
    forwardWeight,
    backwardWeight,
    denseWeight,
    adaptiveWeight,
    ...fusionInput
  } = input;
  return fusionInput;
}

export function buildProductionLiveLaneReport(input = {}) {
  const {
    fusion: providedFusion,
    lane = null,
    taskId = null,
    now,
  } = input;
  const gate = resolveBesJudgmentGate(input);
  const fusionWeights = fusionWeightsFrom(input);
  const fusion = providedFusion ?? fuseLiveBesLane(fuseInputFrom(input));
  evidenceOnlyFusion(fusion);
  const orderingRationale = orderingRationaleFor(fusion, fusionWeights);
  const laneOrderingEvidence = {
    orderedCandidateIds: fusion.orderedCandidateIds,
    fusionWeights,
    orderingRationale,
    evidenceOnly: true,
    promotionEvidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };

  return {
    evidenceType: 'live_lane_report',
    lane,
    taskId,
    generatedAt: normalizeNow(now).toISOString(),
    gate,
    fusion,
    laneOrderingEvidence,
    promotionEvidenceOnly: true,
    evidenceOnly: true,
    canPromote: false,
    promotionAllowed: false,
    promotionAuthority: false,
    authority: 'evidence_only',
  };
}
