const COMPACTION_HARD_CASE_PREFIX = 'compaction_';

import { runBesLaneRuntime } from '../bes/laneRuntime.js';

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function caseReasons(traceCase = {}) {
  return [
    traceCase.reason,
    ...normalizeList(traceCase.reasons),
    ...normalizeList(traceCase.failureModes),
  ].filter(Boolean);
}

function normalizeCases(coreset = []) {
  const list = Array.isArray(coreset)
    ? coreset
    : coreset.items || coreset.cases || coreset.hardCases || [];
  return list
    .map((traceCase = {}) => {
      const reasons = caseReasons(traceCase)
        .filter((reason) => String(reason).startsWith(COMPACTION_HARD_CASE_PREFIX));
      return { ...traceCase, reasons };
    })
    .filter((traceCase) => traceCase.reasons.length > 0);
}

function normalizeWeight(value, fallback) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
}

function basePolicy(baselinePolicy = {}) {
  return {
    preserveConstraintWeight: normalizeWeight(baselinePolicy.preserveConstraintWeight, 0.5),
    continuationWeight: normalizeWeight(baselinePolicy.continuationWeight, 0.3),
    tokenReductionWeight: normalizeWeight(baselinePolicy.tokenReductionWeight, 0.2),
    maxSummaryTokens: Math.max(1000, Math.min(32000, Math.round(baselinePolicy.maxSummaryTokens || 9000))),
    replayWindowEvents: Math.max(10, Math.min(240, Math.round(baselinePolicy.replayWindowEvents || 80))),
  };
}

function sourceCaseId(traceCase, index) {
  return traceCase.caseId || traceCase.traceId || traceCase.id || traceCase.taskId || `case_${index + 1}`;
}

function hasReason(hardCases, reason) {
  return hardCases.some((traceCase) => traceCase.reasons.includes(reason));
}

export function proposeCompactionPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const base = basePolicy(baselinePolicy);
  const constraintPressure = (
    hasReason(hardCases, 'compaction_lost_constraints') ||
    hasReason(hardCases, 'compaction_lost_constraint') ||
    hardCases.some((traceCase) => normalizeList(traceCase.lostConstraints).length > 0)
  );
  const hallucinationPressure = hasReason(hardCases, 'compaction_hallucination');
  const continuationPressure = hasReason(hardCases, 'compaction_continuation_failed');
  const tokenPressure = hasReason(hardCases, 'compaction_token_bloat');
  const sourceCaseIds = hardCases.map(sourceCaseId);
  const hardCaseReasons = unique(hardCases.flatMap((traceCase) => traceCase.reasons));

  const variants = [
    {
      preserveConstraintWeight: round(clamp(base.preserveConstraintWeight + (constraintPressure || hallucinationPressure ? 0.2 : 0.1))),
      continuationWeight: round(clamp(base.continuationWeight + (continuationPressure ? 0.18 : 0.08))),
      tokenReductionWeight: round(clamp(base.tokenReductionWeight + (tokenPressure ? 0.18 : 0.08))),
      maxSummaryTokens: Math.max(1000, Math.round(base.maxSummaryTokens * (tokenPressure ? 0.72 : 0.84))),
      replayWindowEvents: Math.min(240, base.replayWindowEvents + (continuationPressure ? 40 : 20)),
    },
    {
      preserveConstraintWeight: round(clamp(base.preserveConstraintWeight + 0.25)),
      continuationWeight: round(base.continuationWeight),
      tokenReductionWeight: round(base.tokenReductionWeight),
      maxSummaryTokens: Math.max(1000, Math.round(base.maxSummaryTokens * 0.9)),
      replayWindowEvents: Math.min(240, base.replayWindowEvents + 20),
    },
  ];

  return variants.slice(0, Math.max(1, maxCandidates)).map((variant, index) => ({
    policyId: `compaction_shadow_${index + 1}`,
    target: 'compaction_policy',
    ...base,
    ...variant,
    status: 'shadow_only',
    requiresApproval: true,
    directApplyAllowed: false,
    sourceCaseIds,
    hardCaseReasons,
  }));
}

export function evaluateCompactionPolicyCandidate({ candidate, replayCase = {} } = {}) {
  const reasons = [];
  const beforeTokens = Number(replayCase.beforeTokens ?? replayCase.originalTokens ?? 0);
  const afterTokens = Number(replayCase.afterTokens ?? replayCase.compactedTokens ?? candidate?.maxSummaryTokens ?? 0);
  const tokenReduction = beforeTokens > 0 && afterTokens >= 0
    ? clamp((beforeTokens - afterTokens) / beforeTokens)
    : clamp(Number(replayCase.tokenReduction ?? 0));
  const lostConstraints = normalizeList(replayCase.lostConstraints);
  const hallucinations = normalizeList(replayCase.hallucinations);
  const continuationSucceeded = replayCase.continuationSucceeded === true || replayCase.resumeSucceeded === true;

  if (continuationSucceeded) reasons.push('continuation_success');
  if (tokenReduction >= 0.2) reasons.push('token_reduction');
  if (lostConstraints.length > 0) reasons.push('lost_constraints_penalty');
  if (hallucinations.length > 0 || replayCase.hallucinated === true) reasons.push('hallucination_penalty');

  const continuationScore = continuationSucceeded ? 0.4 : -0.2;
  const tokenScore = tokenReduction * Number(candidate?.tokenReductionWeight ?? 0.2);
  const constraintPenalty = lostConstraints.length * Number(candidate?.preserveConstraintWeight ?? 0.5);
  const hallucinationPenalty = hallucinations.length ? 0.45 : 0;
  const score = round(clamp(0.35 + continuationScore + tokenScore - constraintPenalty - hallucinationPenalty));

  return {
    score,
    reasons,
    safety: {
      status: 'shadow_only',
      reasons: ['shadow_policy_no_runtime_mutation'],
    },
    promotable: false,
  };
}

function laneCases(coreset = {}) {
  if (Array.isArray(coreset)) return coreset;
  return coreset.items || coreset.cases || coreset.hardCases || [];
}

function evaluateAcrossCases({ candidate, hardCases, evaluate }) {
  const cases = hardCases.length ? hardCases : [{}];
  const results = cases.map((traceCase) => evaluate(traceCase));
  const score = results.reduce((sum, result) => sum + Number(result.score || 0), 0) / results.length;
  return {
    score,
    reasons: [...new Set(results.flatMap((result) => result.reasons || []))],
    caseCount: cases.length,
    caseResults: results,
    safety: results.find((result) => result.safety)?.safety || { status: 'shadow_only' },
    promotable: false,
  };
}

export async function runCompactionPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'compaction_policy_bes',
  now,
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases, items: hardCases };
  const candidates = proposeCompactionPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'compaction',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (replayCase) => evaluateCompactionPolicyCandidate({ candidate, replayCase }),
    }),
  });
}
