const BUDGET_HARD_CASE_REASONS = new Set([
  'budget_exhausted',
  'budget_pressure',
  'low_confidence_verification',
  'vlm_budget_exhausted',
  'retrieval_budget_exhausted',
]);

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

function normalizeCases(coreset = []) {
  const list = Array.isArray(coreset) ? coreset : coreset.cases || coreset.hardCases || [];
  return list.filter((traceCase = {}) => BUDGET_HARD_CASE_REASONS.has(traceCase.reason));
}

function hasApproval(approvals = []) {
  return approvals.some((approval = {}) => (
    approval.allowCostIncrease === true
      || approval.approveCostIncrease === true
      || approval.costOverride === true
  ));
}

export function proposeBudgetPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const lowConfidence = hardCases.some((traceCase) => traceCase.reason === 'low_confidence_verification' || traceCase.confidence < 0.5);
  const visualPressure = hardCases.some((traceCase) => /vlm|visual/i.test(traceCase.reason || traceCase.taskType || ''));
  const sourceCaseIds = hardCases.map((traceCase, index) => traceCase.caseId || traceCase.traceId || `case_${index + 1}`);

  return [{
    policyId: 'budget_shadow_1',
    verifierSpend: round(clamp((baselinePolicy.verifierSpend ?? 0.25) + (lowConfidence ? 0.18 : 0.05), 0.05, 0.7)),
    vlmSpend: round(clamp((baselinePolicy.vlmSpend ?? 0.15) + (visualPressure ? 0.12 : 0), 0.05, 0.5)),
    retrievalSpend: round(clamp(baselinePolicy.retrievalSpend ?? 0.25, 0.1, 0.5)),
    swarmSpend: round(clamp(baselinePolicy.swarmSpend ?? 0.2, 0.1, 0.5)),
    costMultiplier: round(clamp(baselinePolicy.costMultiplier ?? 1, 0.5, 1.5)),
    status: 'shadow_only',
    sourceCaseIds,
    hardCaseReasons: unique(hardCases.map((traceCase) => traceCase.reason)),
  }].slice(0, maxCandidates);
}

export function evaluateBudgetPolicyCandidate({
  candidate,
  budgetCase = {},
  approvals = [],
} = {}) {
  const reasons = [];
  const costMultiplier = Number(candidate?.costMultiplier ?? 1);
  if (costMultiplier > 1 && !hasApproval(approvals)) {
    reasons.push('cost_increase_requires_approval');
    return {
      score: 0,
      reasons,
      safety: { status: 'human_required' },
      promotable: false,
    };
  }
  if (costMultiplier > 1) {
    reasons.push('cost_increase_approved');
  }

  const confidence = Number(budgetCase.confidence ?? 1);
  if (confidence < 0.5 && (candidate?.verifierSpend || 0) >= 0.35) {
    reasons.push('low_confidence_verifier_budget_escalated');
  }
  if (budgetCase.reason === 'budget_exhausted' && costMultiplier <= 1) {
    reasons.push('budget_pressure_contained');
  }

  const score = round(clamp(0.45 + (reasons.length * 0.2) + ((candidate?.verifierSpend || 0) * 0.2)));
  return {
    score,
    reasons,
    safety: { status: 'shadow_only', reasons: ['shadow_policy_no_runtime_mutation'] },
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

export async function runBudgetPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'budget_policy_bes',
  now,
  approvals = [],
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeBudgetPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'budget',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (budgetCase) => evaluateBudgetPolicyCandidate({ candidate, budgetCase, approvals }),
    }),
  });
}
