const DEFAULT_ARMS = [
  {
    arm: 'go_wider',
    label: 'Spawn or sample new candidate paths',
    cost: 2,
    prior: 0.56,
  },
  {
    arm: 'go_deeper',
    label: 'Improve the current best path',
    cost: 1,
    prior: 0.5,
  },
  {
    arm: 'switch_worker',
    label: 'Change role, profile, model, or tool lane',
    cost: 3,
    prior: 0.43,
  },
  {
    arm: 'gather_evidence',
    label: 'Spend budget on verification or retrieval',
    cost: 2,
    prior: 0.48,
  },
  {
    arm: 'stop_or_promote',
    label: 'Stop search, report, or queue promotion',
    cost: 0,
    prior: 0.35,
  },
];

const DEFAULT_POLICY = {
  mode: 'advisory',
  exploration: 0.18,
  strongRewardThreshold: 0.72,
  highBudgetPressure: 0.9,
};

export function createAdaptiveSearchScheduler({ arms, rng, policy } = {}) {
  const configuredPolicy = { ...DEFAULT_POLICY, ...(policy || {}) };
  const armEntries = normalizeArms(arms);
  const scheduler = {
    version: 1,
    policy: configuredPolicy,
    arms: Object.fromEntries(
      armEntries.map((arm) => [
        arm.arm,
        {
          arm: arm.arm,
          label: arm.label,
          cost: arm.cost,
          prior: arm.prior,
          visits: 0,
          totalReward: 0,
          evidenceCount: 0,
          lastReward: null,
        },
      ]),
    ),
    actions: {},
    history: [],
    nextActionNumber: 1,
  };

  Object.defineProperty(scheduler, 'rng', {
    value: typeof rng === 'function' ? rng : Math.random,
    enumerable: false,
    writable: true,
  });

  return scheduler;
}

export function selectAdaptiveSearchAction({ scheduler, context } = {}) {
  assertScheduler(scheduler);
  const normalizedContext = normalizeContext(context);
  const scores = Object.values(scheduler.arms).map((armState, index) =>
    scoreArm({ armState, context: normalizedContext, scheduler, index }),
  );
  const selectedScore = scores
    .filter((score) => score.eligible)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      return left.index - right.index;
    })[0] || scores.find((score) => score.arm === 'stop_or_promote') || scores[0];

  const actionId = `adaptive_${scheduler.nextActionNumber++}`;
  const action = {
    actionId,
    arm: selectedScore.arm,
    advisory: scheduler.policy.mode !== 'enabled',
    contextId: normalizedContext.taskId,
    trace: {
      type: 'ab_mcts.action_selected',
      actionId,
      selectedArm: selectedScore.arm,
      advisory: scheduler.policy.mode !== 'enabled',
      context: {
        taskId: normalizedContext.taskId,
        evidenceCount: normalizedContext.evidenceCount,
        budgetPressure: normalizedContext.budgetPressure,
      },
      scores: scores.map(({ index, ...score }) => score),
    },
  };

  scheduler.actions[actionId] = {
    actionId,
    arm: action.arm,
    context: action.trace.context,
    selectedAt: scheduler.history.length + 1,
  };
  scheduler.history.push({
    type: 'selected',
    actionId,
    arm: action.arm,
    context: action.trace.context,
  });

  return action;
}

export function recordAdaptiveSearchOutcome({ scheduler, actionId, reward, evidence } = {}) {
  assertScheduler(scheduler);
  const action = scheduler.actions?.[actionId];
  if (!action) {
    throw new Error(`Unknown adaptive search action: ${actionId || '<missing>'}`);
  }

  const normalizedReward = normalizeAdaptiveSearchReward(reward);
  const armState = scheduler.arms[action.arm];
  armState.visits += 1;
  armState.totalReward = round(armState.totalReward + normalizedReward);
  armState.evidenceCount += evidence ? 1 : 0;
  armState.lastReward = normalizedReward;

  const outcome = {
    type: 'ab_mcts.outcome_recorded',
    actionId,
    arm: action.arm,
    reward: normalizedReward,
    evidence: summarizeEvidence(evidence),
  };
  action.outcome = outcome;
  scheduler.lastOutcome = outcome;
  scheduler.history.push(outcome);

  return outcome;
}

export function normalizeAdaptiveSearchReward(reward) {
  if (Number.isFinite(reward)) return clamp01(reward);
  if (!reward || typeof reward !== 'object') return 0.5;

  const components = [];

  if (reward.verifier) {
    const confidence = clamp01(reward.verifier.confidence ?? 0.5);
    components.push(reward.verifier.passed ? 0.62 + confidence * 0.32 : confidence * 0.28);
  }
  if (reward.bes) {
    components.push(clamp01(reward.bes.goalSatisfaction ?? reward.bes.score ?? 0.5));
  }
  if (reward.swarm) {
    components.push(clamp01(reward.swarm.championScore ?? reward.swarm.score ?? 0.5));
  }
  if (reward.visual) {
    components.push(clamp01(reward.visual.evidenceQuality ?? reward.visual.confidence ?? 0.5));
  }
  if (reward.research) {
    components.push(clamp01(reward.research.synthesisConfidence ?? reward.research.sourceQuality ?? 0.5));
  }

  let normalized = components.length
    ? components.reduce((sum, value) => sum + value, 0) / components.length
    : clamp01(reward.score ?? reward.value ?? 0.5);

  const costPressure = clamp01(reward.cost?.pressure ?? reward.budgetPressure ?? 0);
  const latencyPenalty = Number.isFinite(reward.cost?.latencyMs)
    ? Math.min(0.12, reward.cost.latencyMs / 120000)
    : 0;
  normalized -= costPressure * 0.14 + latencyPenalty;

  if (reward.safetyRejected || reward.approvalRejected || reward.safety?.rejected) {
    normalized *= 0.35;
  }

  return round(clamp01(normalized));
}

function normalizeArms(arms) {
  const source = Array.isArray(arms) && arms.length ? arms : DEFAULT_ARMS;
  return source.map((arm) => {
    if (typeof arm === 'string') {
      const defaults = DEFAULT_ARMS.find((candidate) => candidate.arm === arm);
      return defaults || { arm, label: arm, cost: 1, prior: 0.45 };
    }
    const defaults = DEFAULT_ARMS.find((candidate) => candidate.arm === arm.arm);
    return {
      arm: arm.arm,
      label: arm.label || defaults?.label || arm.arm,
      cost: Number.isFinite(arm.cost) ? arm.cost : defaults?.cost ?? 1,
      prior: clamp01(arm.prior ?? defaults?.prior ?? 0.45),
    };
  });
}

function normalizeContext(context = {}) {
  const evidence = Array.isArray(context.evidence) ? context.evidence : [];
  return {
    taskId: context.taskId || context.contextId || 'adaptive_search_context',
    evidence,
    evidenceCount: Number.isFinite(context.evidenceCount) ? context.evidenceCount : evidence.length,
    budgetPressure: clamp01(context.budget?.pressure ?? context.budgetPressure ?? 0),
    remainingActions: context.budget?.remainingActions ?? context.remainingActions ?? Infinity,
    bestCandidateScore: clamp01(context.bestCandidate?.score ?? context.bestScore ?? 0),
    confidence: clamp01(context.confidence ?? context.bestCandidate?.confidence ?? 0),
    hasContradictions: Boolean(context.signals?.hasContradictions || context.contradictions?.length),
  };
}

function scoreArm({ armState, context, scheduler, index }) {
  const meanReward = armState.visits > 0 ? armState.totalReward / armState.visits : armState.prior;
  const randomProbe = Number(scheduler.rng?.() ?? 0.5);
  const exploration = scheduler.policy.exploration * clamp01(randomProbe) / Math.sqrt(armState.visits + 1);
  const reasons = [];
  let contextBonus = 0;
  let eligible = true;

  if (context.budgetPressure >= scheduler.policy.highBudgetPressure && armState.cost >= 2) {
    eligible = false;
    reasons.push('budget_pressure_removes_expensive_arm');
  }

  if (context.evidenceCount === 0 && armState.arm === 'go_wider') {
    contextBonus += 0.36;
    reasons.push('no_evidence_prefers_wider_sampling');
  }
  if (scheduler.lastOutcome?.reward >= scheduler.policy.strongRewardThreshold && armState.arm === 'go_deeper') {
    contextBonus += 0.31;
    reasons.push('strong_reward_deepen_promising_branch');
  }
  if (context.bestCandidateScore >= 0.75 && armState.arm === 'go_deeper') {
    contextBonus += 0.14;
    reasons.push('best_candidate_available');
  }
  if (context.evidenceCount > 0 && context.confidence < 0.55 && armState.arm === 'gather_evidence') {
    contextBonus += 0.15;
    reasons.push('low_confidence_needs_evidence');
  }
  if (context.hasContradictions && armState.arm === 'gather_evidence') {
    contextBonus += 0.12;
    reasons.push('contradictions_need_resolution');
  }
  if (context.budgetPressure >= 0.8 && armState.arm === 'stop_or_promote') {
    contextBonus += 0.2;
    reasons.push('budget_pressure_consider_stop');
  }

  const costPenalty = context.budgetPressure * armState.cost * 0.1;
  const totalScore = round((eligible ? meanReward + exploration + contextBonus - costPenalty : -Infinity));

  return {
    index,
    arm: armState.arm,
    visits: armState.visits,
    meanReward: round(meanReward),
    exploration: round(exploration),
    contextBonus: round(contextBonus),
    costPenalty: round(costPenalty),
    totalScore,
    eligible,
    reason: reasons.length ? reasons.join(',') : 'baseline_policy_score',
  };
}

function summarizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence ?? null;
  return Object.fromEntries(
    Object.entries(evidence).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value) || value === null,
    ),
  );
}

function assertScheduler(scheduler) {
  if (!scheduler || typeof scheduler !== 'object' || !scheduler.arms) {
    throw new Error('Adaptive search scheduler is required');
  }
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value) {
  if (value === Infinity || value === -Infinity) return value;
  return Math.round(value * 1000000) / 1000000;
}
