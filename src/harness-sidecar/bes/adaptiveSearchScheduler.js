import { planModelChoiceMcts } from './modelChoiceMcts.js';

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

const DEFAULT_ACTION_TYPES = [
  { actionType: 'text', label: 'Generate or revise text reasoning', cost: 1, prior: 0.45 },
  { actionType: 'tool', label: 'Run a tool-backed action', cost: 2, prior: 0.42 },
  { actionType: 'swarm', label: 'Spawn or query a swarm lane', cost: 3, prior: 0.4 },
  { actionType: 'visual', label: 'Collect or inspect visual evidence', cost: 2, prior: 0.44 },
  { actionType: 'replay', label: 'Run replay against hard cases', cost: 2, prior: 0.46 },
  { actionType: 'verifier', label: 'Run verifier evidence', cost: 2, prior: 0.5 },
];

const DEFAULT_POLICY = {
  mode: 'advisory',
  exploration: 0.18,
  strongRewardThreshold: 0.72,
  highBudgetPressure: 0.9,
};

export function createAdaptiveSearchScheduler({ arms, rng, policy, modelArms } = {}) {
  const configuredPolicy = { ...DEFAULT_POLICY, ...(policy || {}) };
  const armEntries = normalizeArms(arms);
  const actionTypeEntries = normalizeActionTypes();
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
    actionTypes: Object.fromEntries(
      actionTypeEntries.map((actionType) => [
        actionType.actionType,
        {
          actionType: actionType.actionType,
          label: actionType.label,
          cost: actionType.cost,
          prior: actionType.prior,
          visits: 0,
          totalReward: 0,
          lastReward: null,
        },
      ]),
    ),
    actions: {},
    history: [],
    nextActionNumber: 1,
    nextModelChoiceNumber: 1,
    modelArms: normalizeModelArms(modelArms),
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
  let selectedScore = scores
    .filter((score) => score.eligible)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      return left.index - right.index;
    })[0] || scores.find((score) => score.arm === 'stop_or_promote') || scores[0];
  const actionTypeScores = Object.values(scheduler.actionTypes || {}).map((actionTypeState, index) =>
    scoreActionType({ actionTypeState, context: normalizedContext, scheduler, index }),
  );
  const eligibleActionTypeScores = actionTypeScores
    .filter((score) => score.eligible)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      return left.index - right.index;
    });
  const actionTypeExhausted = actionTypeScores.length > 0 && eligibleActionTypeScores.length === 0;
  const selectedActionTypeScore = actionTypeExhausted ? null : eligibleActionTypeScores[0];
  if (actionTypeExhausted) {
    selectedScore = scores.find((score) => score.arm === 'stop_or_promote') || selectedScore;
  }

  const actionId = `adaptive_${scheduler.nextActionNumber++}`;
  const action = {
    actionId,
    arm: selectedScore.arm,
    actionType: selectedActionTypeScore?.actionType || null,
    modelChoice: selectModelChoice({
      scheduler,
      actionId,
      actionArm: selectedScore.arm,
      context: normalizedContext,
    }),
    advisory: scheduler.policy.mode !== 'enabled',
    contextId: normalizedContext.taskId,
    trace: {
      type: 'ab_mcts.action_selected',
      actionId,
      selectedArm: selectedScore.arm,
      selectedActionType: selectedActionTypeScore?.actionType || null,
      advisory: scheduler.policy.mode !== 'enabled',
      context: {
        taskId: normalizedContext.taskId,
        evidenceCount: normalizedContext.evidenceCount,
        budgetPressure: normalizedContext.budgetPressure,
      },
      scores: scores.map(({ index, ...score }) => score),
      actionTypeScores: actionTypeScores.map(({ index, ...score }) => score),
      actionTypeExhausted,
    },
  };
  if (action.modelChoice) {
    action.trace.modelChoice = action.modelChoice;
  }

  scheduler.actions[actionId] = {
    actionId,
    arm: action.arm,
    actionType: action.actionType,
    modelChoice: action.modelChoice,
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
  const actionTypeState = scheduler.actionTypes?.[action.actionType];
  if (actionTypeState) {
    actionTypeState.visits += 1;
    actionTypeState.totalReward = round(actionTypeState.totalReward + normalizedReward);
    actionTypeState.lastReward = normalizedReward;
  }

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

function normalizeActionTypes() {
  return DEFAULT_ACTION_TYPES.map((actionType) => ({
    ...actionType,
    prior: clamp01(actionType.prior),
  }));
}

function normalizeContext(context = {}) {
  const evidence = Array.isArray(context.evidence) ? context.evidence : [];
  const remainingByActionType = context.budget?.remainingByActionType
    || context.remainingByActionType
    || {};
  return {
    taskId: context.taskId || context.contextId || 'adaptive_search_context',
    evidence,
    evidenceCount: Number.isFinite(context.evidenceCount) ? context.evidenceCount : evidence.length,
    budgetPressure: clamp01(context.budget?.pressure ?? context.budgetPressure ?? 0),
    remainingActions: context.budget?.remainingActions ?? context.remainingActions ?? Infinity,
    remainingByActionType,
    bestCandidateScore: clamp01(context.bestCandidate?.score ?? context.bestScore ?? 0),
    confidence: clamp01(context.confidence ?? context.bestCandidate?.confidence ?? 0),
    hasContradictions: Boolean(context.signals?.hasContradictions || context.contradictions?.length),
    signals: context.signals || {},
    allowModelChoice: context.allowModelChoice === true,
    modelChoiceMode: context.modelChoiceMode || 'thompson_mcts',
    modelArms: normalizeModelArms(context.modelArms),
    routerPolicy: context.routerPolicy,
    priorEvidence: context.priorEvidence,
  };
}

function normalizeModelArms(modelArms = []) {
  return asArray(modelArms)
    .filter((arm) => arm && typeof arm === 'object')
    .map((arm, index) => {
      const fallback = `model_arm_${index + 1}`;
      const armId = String(arm.armId ?? arm.id ?? arm.modelProfile ?? fallback).trim() || fallback;
      return {
        armId,
        role: arm.role || 'implementer',
        modelProfile: arm.modelProfile || armId,
        endpointProfile: arm.endpointProfile || null,
        posterior: arm.posterior && typeof arm.posterior === 'object'
          ? {
            alpha: Number.isFinite(Number(arm.posterior.alpha)) ? Number(arm.posterior.alpha) : 1,
            beta: Number.isFinite(Number(arm.posterior.beta)) ? Number(arm.posterior.beta) : 1,
            observations: Number.isFinite(Number(arm.posterior.observations))
              ? Number(arm.posterior.observations)
              : 0,
          }
          : null,
      };
    });
}

function selectModelChoice({ scheduler, actionId, actionArm, context }) {
  if (context.allowModelChoice !== true) return null;
  const modelArms = context.modelArms.length ? context.modelArms : scheduler.modelArms;
  if (!modelArms.length) return null;

  const plan = planModelChoiceMcts({
    task: { taskId: context.taskId, type: context.taskType },
    actionArms: [actionArm],
    modelArms,
    routerPolicy: context.routerPolicy,
    priorEvidence: context.priorEvidence,
    iterations: Math.max(1, Math.min(8, modelArms.length * 2)),
    rng: scheduler.rng,
  });
  const selected = plan.selectedNode || {};
  const fallback = modelArms[0];
  const actionNumber = scheduler.nextModelChoiceNumber++;

  return {
    actionId: selected.actionId || `model_choice_${actionNumber}`,
    parentActionId: actionId,
    armId: selected.armId || fallback.armId,
    role: selected.role || fallback.role || 'implementer',
    modelProfile: selected.modelProfile || fallback.modelProfile,
    endpointProfile: selected.endpointProfile ?? fallback.endpointProfile ?? null,
    authority: 'evidence_only',
    canPromote: false,
    mode: context.modelChoiceMode,
    posterior: selected.routerPosterior || fallback.posterior || null,
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

function scoreActionType({ actionTypeState, context, scheduler, index }) {
  const meanReward = actionTypeState.visits > 0
    ? actionTypeState.totalReward / actionTypeState.visits
    : actionTypeState.prior;
  const randomProbe = Number(scheduler.rng?.() ?? 0.5);
  const exploration = scheduler.policy.exploration * clamp01(randomProbe) / Math.sqrt(actionTypeState.visits + 1);
  const remaining = context.remainingByActionType?.[actionTypeState.actionType];
  const reasons = [];
  let contextBonus = 0;
  let eligible = remaining === undefined || remaining === null || Number(remaining) > 0;

  if (!eligible) reasons.push('action_budget_exhausted');
  if (context.budgetPressure >= scheduler.policy.highBudgetPressure && actionTypeState.cost >= 3) {
    eligible = false;
    reasons.push('budget_pressure_removes_expensive_action_type');
  }

  if (actionTypeState.actionType === 'verifier') {
    if (context.signals.needsVerifier || context.bestCandidateScore >= 0.75) {
      contextBonus += 0.34;
      reasons.push('candidate_needs_verifier');
    }
    if (context.confidence < 0.65) {
      contextBonus += 0.12;
      reasons.push('low_confidence_verification');
    }
  }
  if (actionTypeState.actionType === 'replay' && (context.signals.needsReplay || context.signals.failedReplayCount > 0)) {
    contextBonus += 0.28;
    reasons.push('hard_cases_need_replay');
  }
  if (actionTypeState.actionType === 'visual' && context.signals.visualSurface) {
    contextBonus += 0.22;
    reasons.push('visual_surface_needs_evidence');
  }
  if (actionTypeState.actionType === 'tool' && context.signals.needsTool) {
    contextBonus += 0.18;
    reasons.push('tool_action_requested');
  }
  if (actionTypeState.actionType === 'swarm' && (context.signals.needsSwarm || context.evidenceCount === 0)) {
    contextBonus += 0.14;
    reasons.push('swarm_sampling_requested');
  }
  if (actionTypeState.actionType === 'text' && !context.signals.needsVerifier && !context.signals.needsReplay) {
    contextBonus += 0.06;
    reasons.push('text_reasoning_baseline');
  }

  const costPenalty = context.budgetPressure * actionTypeState.cost * 0.08;
  const totalScore = round(eligible ? meanReward + exploration + contextBonus - costPenalty : -Infinity);

  return {
    index,
    actionType: actionTypeState.actionType,
    visits: actionTypeState.visits,
    meanReward: round(meanReward),
    exploration: round(exploration),
    contextBonus: round(contextBonus),
    costPenalty: round(costPenalty),
    totalScore,
    eligible,
    reason: reasons.length ? reasons.join(',') : 'baseline_action_type_score',
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

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
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
