function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function goalScore(attempt = {}) {
  return clamp(numeric(attempt.goalScore?.score ?? attempt.planning?.score ?? attempt.score, 0), 0, 1);
}

function budgetPressure(budgetState = {}) {
  return Math.max(
    numeric(budgetState.budgetPercent, 0),
    numeric(budgetState.contextPercent, 0),
  );
}

function rationaleParts({ attempt, score, novelty, pressure, visual }) {
  const parts = [];
  if (score >= 0.7) parts.push('high goal score');
  if (score > 0 && score < 0.7) parts.push('partial goal score');
  if (score === 0) parts.push('baseline budget');
  if (novelty >= 0.5) parts.push('exploration budget for novelty');
  if (visual) parts.push('visual specialist artifact allowance');
  if (pressure >= 85) parts.push('downshifted for budget pressure');
  if (attempt.planning?.strategy) parts.push(`planned by ${attempt.planning.strategy}`);
  return parts.join('; ');
}

export function allocateEvolutionSwarmBudgets({
  attempts = [],
  budgetState = {},
  maxOutputChars = 1200,
  visualBudget = {},
} = {}) {
  const pressure = budgetPressure(budgetState);
  const pressureMultiplier = pressure >= 90 ? 0.55 : (pressure >= 85 ? 0.7 : 1);

  return attempts.map((attempt) => {
    const score = goalScore(attempt);
    const weight = clamp(numeric(attempt.budgetWeight, score || 0.35), 0.1, 1);
    const novelty = clamp(numeric(attempt.novelty ?? attempt.planning?.novelty, 0), 0, 1);
    const explorationFloor = novelty >= 0.5 ? 0.22 : 0.1;
    const priority = clamp((score * 0.65) + (weight * 0.25) + (novelty * 0.1), explorationFloor, 1);
    const visual = attempt.specialization === 'visual-specialist';
    const allocatedChars = Math.max(100, Math.round(maxOutputChars * priority * pressureMultiplier));
    const maxToolCalls = Math.max(1, Math.round((visual ? 4 : 3) * priority * pressureMultiplier));
    const budget = {
      ...(attempt.budget || {}),
      maxOutputChars: allocatedChars,
      maxToolCalls,
      visualArtifactsAllowed: visual,
      priority,
    };
    if (visual) {
      budget.visual = {
        maxArtifacts: visualBudget.maxArtifacts ?? 2,
        ...(visualBudget || {}),
      };
    }
    const budgetRationale = {
      maxOutputChars: budget.maxOutputChars,
      maxToolCalls: budget.maxToolCalls,
      visualArtifactsAllowed: budget.visualArtifactsAllowed,
      priority,
      rationale: rationaleParts({ attempt, score, novelty, pressure, visual }),
    };

    return {
      ...attempt,
      budget,
      budgetRationale,
    };
  });
}
