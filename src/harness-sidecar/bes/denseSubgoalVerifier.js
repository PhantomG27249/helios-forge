function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function evidenceText(entry) {
  if (typeof entry === 'string') return entry.toLowerCase();
  return [
    entry?.id,
    entry?.goalId,
    entry?.subgoalId,
    entry?.command,
    entry?.summary,
    entry?.note,
    entry?.text,
  ].filter(Boolean).join(' ').toLowerCase();
}

function requirementText(subgoal = {}) {
  return asArray(subgoal.requires ?? subgoal.requirement ?? subgoal.command ?? subgoal.id)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function subgoalId(subgoal, index) {
  return String(subgoal?.id ?? subgoal?.subgoalId ?? `subgoal_${index + 1}`);
}

function satisfiesSubgoal(subgoal, evidence) {
  const requirements = requirementText(subgoal);
  if (requirements.length === 0) return false;
  const haystack = evidence.map(evidenceText);
  return requirements.every((requirement) => haystack.some((entry) => entry.includes(requirement)));
}

export function verifyDenseSubgoals({ subgoals = [], evidence = [] } = {}) {
  const normalizedSubgoals = asArray(subgoals);
  const normalizedEvidence = asArray(evidence);
  const satisfiedSubgoalIds = [];
  const missingSubgoalIds = [];
  const denseFeedback = [];

  normalizedSubgoals.forEach((subgoal, index) => {
    const id = subgoalId(subgoal, index);
    const satisfied = satisfiesSubgoal(subgoal, normalizedEvidence);
    if (satisfied) {
      satisfiedSubgoalIds.push(id);
    } else {
      missingSubgoalIds.push(id);
    }
    denseFeedback.push({
      subgoalId: id,
      status: satisfied ? 'satisfied' : 'missing',
      requires: requirementText(subgoal),
    });
  });

  const total = normalizedSubgoals.length;
  return {
    score: total > 0 ? satisfiedSubgoalIds.length / total : 0,
    satisfiedSubgoalIds,
    missingSubgoalIds,
    denseFeedback,
    total,
  };
}
