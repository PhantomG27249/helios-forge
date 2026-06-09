function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function evaluationScore(evaluation = {}) {
  if (Number.isFinite(evaluation.totalScore)) return clamp01(evaluation.totalScore);
  if (Number.isFinite(evaluation.score)) return clamp01(evaluation.score);
  return normalizeSkillEvolutionReward({ evaluation }).score;
}

function bestEvaluation(evaluations = []) {
  return [...evaluations]
    .sort((a, b) => evaluationScore(b) - evaluationScore(a))
    .at(0) || null;
}

export function normalizeSkillEvolutionReward({ candidate = {}, evaluation = {} } = {}) {
  const components = {
    baselineImprovement: clamp01(evaluation.baselineImprovement ?? evaluation.improvement ?? 0),
    scaffoldAdherence: clamp01(evaluation.scaffoldAdherence ?? 0),
    triggerPrecision: clamp01(evaluation.triggerPrecision ?? 0),
    verifierEvidenceScore: clamp01(evaluation.verifierEvidenceScore ?? 0),
    safetyScore: clamp01(evaluation.safetyScore ?? (evaluation.safety?.globalWrites || evaluation.safety?.secrets ? 0 : 1)),
    promptInjectionHygiene: clamp01(evaluation.promptInjectionHygiene ?? 0),
    costLatencyScore: clamp01(evaluation.costLatencyScore ?? 0.7),
  };
  const score = (
    components.baselineImprovement * 0.18
    + components.scaffoldAdherence * 0.12
    + components.triggerPrecision * 0.14
    + components.verifierEvidenceScore * 0.18
    + components.safetyScore * 0.22
    + components.promptInjectionHygiene * 0.1
    + components.costLatencyScore * 0.06
  );

  return {
    candidateId: candidate.candidateId || evaluation.candidateId || null,
    score,
    components,
  };
}

export function buildSkillEvolutionSearchContext({
  skillNeed,
  candidates = [],
  evaluations = [],
  budget = {},
} = {}) {
  const traceEvents = [];
  const remainingIterations = budget.remainingIterations ?? budget.iterations ?? 0;

  function emit(type, payload = {}) {
    traceEvents.push({
      type,
      skillNeedId: skillNeed?.needId || null,
      ...payload,
    });
  }

  function selectAction() {
    const best = bestEvaluation(evaluations);
    const bestScore = best ? evaluationScore(best) : 0;
    const confidence = best?.confidence ?? (best?.replayCases >= 3 ? 0.8 : 0.5);
    const replayCases = best?.replayCases ?? 0;

    if (!best || bestScore < 0.55) {
      const action = {
        type: 'go_wider',
        effect: 'create_more_skill_variants',
        reason: 'no strong candidate yet',
        count: Math.max(1, Math.min(3, remainingIterations || 1)),
      };
      emit('skill_evolution.ab_mcts_action_selected', { action: action.type, reason: action.reason });
      return action;
    }

    if ((confidence < 0.6 || replayCases < 2) && bestScore >= 0.7 && remainingIterations > 0) {
      const action = {
        type: 'gather_evidence',
        candidateId: best.candidateId,
        effect: 'request_more_trace_replay_or_verifier_cases',
        reason: 'ambiguous reward',
      };
      emit('skill_evolution.evidence_requested', { candidateId: best.candidateId });
      return action;
    }

    if (bestScore >= 0.85 || remainingIterations <= 0) {
      const action = {
        type: 'stop_or_promote',
        candidateId: best.candidateId,
        recommendation: bestScore >= 0.85 ? 'promotion_review' : 'stop_without_promotion',
        install: false,
        reason: bestScore >= 0.85 ? 'candidate ready for approval-gated promotion review' : 'budget exhausted',
      };
      emit('skill_evolution.ab_mcts_action_selected', { action: action.type, candidateId: best.candidateId });
      return action;
    }

    const action = {
      type: 'go_deeper',
      candidateId: best.candidateId,
      effect: 'refine_current_best_skill',
      reason: 'partial success',
    };
    emit('skill_evolution.candidate_refined', { candidateId: best.candidateId });
    return action;
  }

  if (skillNeed?.sourceSkill) {
    emit('skill_evolution.source_snapshot_selected', {
      sourceSnapshotId: skillNeed.sourceSkill.snapshotId || skillNeed.sourceSkill.sourceSnapshotId || null,
    });
  }

  return {
    skillNeed,
    candidates,
    evaluations,
    budget: { remainingIterations },
    traceEvents,
    selectAction,
  };
}
