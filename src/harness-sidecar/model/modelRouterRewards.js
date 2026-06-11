import { modelRouterKey, sanitizeRouterEvidence } from './modelRouterState.js';

export const DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS = Object.freeze({
  verifier: 0.4,
  reviewer: 0.2,
  councilAgreement: 0.15,
  safety: 0.15,
  latency: 0.05,
  cost: 0.05,
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, limit = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric > 1) return clamp01(numeric / 100);
  return clamp01(numeric);
}

function nonNegativeNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
}

function normalizeWeights(weights = DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS) {
  return {
    ...DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS,
    ...(isPlainObject(weights) ? weights : {}),
  };
}

function resolveRoute(attempt = {}) {
  const route = attempt.model?.route || attempt.route || {};
  const modelProfile = boundedString(route.modelProfile ?? attempt.modelProfile ?? attempt.model?.modelProfile);
  if (!modelProfile) return null;
  return {
    armId: boundedString(route.armId) || modelProfile,
    modelProfile,
    endpointProfile: boundedString(route.endpointProfile ?? attempt.endpointProfile ?? attempt.model?.endpointProfile),
  };
}

function reviewFailed(review = {}, attempt = {}) {
  const status = boundedString(review.status ?? attempt.reviewStatus).toLowerCase();
  if (['failed', 'fail', 'rejected', 'contract_failed'].includes(status)) return true;
  if (review.passed === false || attempt.reviewPassed === false) return true;
  return false;
}

function contractFailed(attempt = {}) {
  const status = boundedString(attempt.status ?? attempt.outcome ?? attempt.failureMode).toLowerCase();
  return status === 'contract_failed' || (Array.isArray(attempt.failureModes) && attempt.failureModes.includes('contract_failed'));
}

function councilAgreed(councilReport = {}) {
  const disagreementStatus = boundedString(councilReport?.disagreement?.status).toLowerCase();
  if (['present', 'high', 'major'].includes(disagreementStatus)) return false;
  return true;
}

function latencyBonus(latencyMs) {
  const latency = nonNegativeNumber(latencyMs);
  if (latency === null) return 0;
  if (latency <= 1000) return 1;
  if (latency >= 20000) return 0;
  return clamp01(1 - ((latency - 1000) / 19000));
}

function costBonus(costEstimate) {
  const cost = nonNegativeNumber(costEstimate);
  if (cost === null) return 0;
  if (cost <= 0.01) return 1;
  if (cost >= 2) return 0;
  return clamp01(1 - ((cost - 0.01) / 1.99));
}

export function modelRouterRewardFromAttempt({
  attempt,
  review,
  councilReport,
  weights = DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS,
} = {}) {
  if (!isPlainObject(attempt)) return null;
  const route = resolveRoute(attempt);
  if (!route) return null;

  const verifierKnown = typeof attempt.verifierPassed === 'boolean';
  const safetyBlocked = attempt.safetyBlocked === true || attempt.safety?.blocked === true;
  const hasHardFailure = contractFailed(attempt) || safetyBlocked || reviewFailed(review, attempt);
  if (!verifierKnown && !hasHardFailure) return null;

  const safeWeights = normalizeWeights(weights);
  const reasons = [];
  const score = normalizeScore(attempt.score ?? attempt.verifierScore ?? attempt.metrics?.score);
  let reward = 0;
  const qualityPassed = verifierKnown && attempt.verifierPassed === true && !hasHardFailure;

  if (safetyBlocked) {
    reasons.push('safety_blocked');
  }
  if (contractFailed(attempt)) {
    reasons.push('contract_failed');
  }
  if (reviewFailed(review, attempt)) {
    reasons.push('review_failed');
  }

  if (qualityPassed) {
    reward += safeWeights.verifier;
    reward += safeWeights.reviewer * score;
    reward += safeWeights.safety;
    if (councilAgreed(councilReport)) {
      reward += safeWeights.councilAgreement;
      reasons.push('council_agreement');
    } else {
      reward += safeWeights.councilAgreement * 0.25;
      reasons.push('council_disagreement');
    }
    reward += safeWeights.latency * latencyBonus(attempt.metrics?.latencyMs ?? attempt.latencyMs);
    reward += safeWeights.cost * costBonus(attempt.metrics?.costEstimate ?? attempt.costEstimate);
    reasons.push('verifier_passed');
  } else {
    if (verifierKnown && attempt.verifierPassed === false) reasons.push('verifier_failed');
    reward += safeWeights.verifier * 0.1 * score;
    if (!safetyBlocked && !contractFailed(attempt)) reward += safeWeights.safety * 0.25;
    if (!councilAgreed(councilReport)) reasons.push('council_disagreement');
  }

  const evidence = sanitizeRouterEvidence({
    taskId: attempt.taskId,
    attemptId: attempt.attemptId,
    role: attempt.role,
    modelProfile: route.modelProfile,
    endpointProfile: route.endpointProfile,
    verifierPassed: verifierKnown ? attempt.verifierPassed : false,
    score,
    latencyMs: attempt.metrics?.latencyMs ?? attempt.latencyMs,
    costEstimate: attempt.metrics?.costEstimate ?? attempt.costEstimate,
    safetyBlocked,
    failureModes: [
      ...(Array.isArray(attempt.failureModes) ? attempt.failureModes : []),
      ...reasons.filter((reason) => ['contract_failed', 'safety_blocked', 'review_failed', 'verifier_failed'].includes(reason)),
    ],
  });

  return {
    key: modelRouterKey({ role: attempt.role, taskType: attempt.taskType ?? attempt.type, nodeKind: attempt.nodeKind }),
    armId: route.armId,
    reward: clamp01(Number(reward.toFixed(6))),
    evidence,
    reasons,
  };
}

export function modelRouterRewardsFromSwarmResult({ result, weights } = {}) {
  if (!isPlainObject(result)) return [];
  const attempts = Array.isArray(result.attempts)
    ? result.attempts
    : Array.isArray(result.swarm?.attempts)
      ? result.swarm.attempts
      : [];
  const councilReport = result.councilReport || result.modelCouncil || result.council;
  const taskId = result.task?.taskId ?? result.taskId;
  const taskType = result.task?.type ?? result.taskType;

  return attempts
    .map((attempt) => modelRouterRewardFromAttempt({
      attempt: {
        ...attempt,
        taskId: attempt.taskId ?? taskId,
        taskType: attempt.taskType ?? taskType,
      },
      review: attempt.review,
      councilReport,
      weights,
    }))
    .filter(Boolean);
}
