function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function normalizeEvidence(candidate = {}) {
  return [
    ...asArray(candidate.evidence),
    ...asArray(candidate.verifierEvidence),
    ...asArray(candidate.visualEvidence),
    ...asArray(candidate.artifacts),
  ];
}

function hasDirectGoal(candidate, evidence, goalId) {
  return (
    asArray(candidate.satisfiedGoalIds).includes(goalId) ||
    asArray(candidate.solvedGoalIds).includes(goalId) ||
    asArray(candidate.solvedSubgoalIds).includes(goalId) ||
    evidence.some((entry) => (
      (entry.goalId === goalId || entry.subgoalId === goalId) &&
      entry.passed !== false
    ))
  );
}

function tagsMatch(entryTags, goalTags) {
  const entrySet = new Set(asArray(entryTags).map(stableString));
  return asArray(goalTags).some((tag) => entrySet.has(stableString(tag)));
}

function hasKindEvidence(candidate, evidence, goal) {
  const kind = goal.check?.kind;
  if (!kind) return false;

  if (kind === 'visual') {
    return Boolean(
      candidate.visual?.passed === true ||
      evidence.some((entry) => (
        entry.passed !== false &&
        (
          entry.kind === 'visual' ||
          entry.visual === true ||
          tagsMatch(entry.tags, goal.check.tags) ||
          asArray(entry.caseIds).some((caseId) => asArray(goal.check.caseIds).includes(caseId))
        )
      ))
    );
  }

  if (kind === 'failure_mode') {
    return evidence.some((entry) => (
      entry.passed !== false &&
      (
        entry.failureMode === goal.check.failureMode ||
        stableString(entry.note).toLowerCase().includes(goal.check.failureMode) ||
        tagsMatch(entry.tags, [goal.check.failureMode])
      )
    ));
  }

  if (kind === 'rho_coverage') {
    return evidence.some((entry) => (
      entry.passed !== false &&
      asArray(entry.caseIds).some((caseId) => asArray(goal.check.caseIds).includes(caseId))
    ));
  }

  return false;
}

function goalSatisfied(candidate, evidence, goal) {
  return hasDirectGoal(candidate, evidence, goal.id) || hasKindEvidence(candidate, evidence, goal);
}

export function scoreGoalSatisfaction({ goalTree, candidate = {} } = {}) {
  const goals = (goalTree?.nodes || []).filter((goal) => goal.id !== 'goal_root');
  const evidence = normalizeEvidence(candidate);
  const denseFeedback = goals.map((goal) => {
    const satisfied = goalSatisfied(candidate, evidence, goal);
    return {
      goalId: goal.id,
      status: satisfied ? 'satisfied' : 'missing',
      weight: Number.isFinite(goal.weight) ? goal.weight : 1,
      description: goal.description,
      source: goal.source,
      check: goal.check,
    };
  });
  const totalWeight = denseFeedback.reduce((sum, item) => sum + item.weight, 0);
  const satisfiedWeight = denseFeedback
    .filter((item) => item.status === 'satisfied')
    .reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight ? Number((satisfiedWeight / totalWeight).toFixed(6)) : 0;

  return {
    candidateId: candidate.candidateId || candidate.id,
    score,
    percent: Math.round(score * 100),
    satisfiedGoalIds: denseFeedback.filter((item) => item.status === 'satisfied').map((item) => item.goalId),
    missingGoalIds: denseFeedback.filter((item) => item.status === 'missing').map((item) => item.goalId),
    denseFeedback,
  };
}
