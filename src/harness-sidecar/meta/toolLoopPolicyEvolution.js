const TOOL_LOOP_HARD_CASE_REASONS = new Set([
  'unknown_tool',
  'malformed_json_repair_failed',
  'tool_error',
  'tool_timeout',
  'approval_loop',
]);

import { runBesLaneRuntime } from '../bes/laneRuntime.js';

const UNSAFE_TOOL_PATTERNS = [
  /(^|\.)(write|delete|remove|move|apply|merge|push|commit)$/i,
  /shell\.(run|write|exec)/i,
  /git\.(push|merge|commit)/i,
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCases(coreset = []) {
  const list = Array.isArray(coreset) ? coreset : coreset.cases || coreset.hardCases || [];
  return list.filter((traceCase = {}) => TOOL_LOOP_HARD_CASE_REASONS.has(traceCase.reason));
}

function isUnsafeTool(toolName) {
  return UNSAFE_TOOL_PATTERNS.some((pattern) => pattern.test(String(toolName || '')));
}

export function proposeToolLoopPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const repairPressure = hardCases.some((traceCase) => traceCase.reason === 'malformed_json_repair_failed');
  const retryPressure = hardCases.some((traceCase) => ['tool_error', 'tool_timeout'].includes(traceCase.reason));
  const sourceCaseIds = hardCases.map((traceCase, index) => traceCase.caseId || traceCase.traceId || `case_${index + 1}`);
  const hardCaseReasons = unique(hardCases.map((traceCase) => traceCase.reason));
  const safeFallbackTools = (baselinePolicy.safeFallbackTools || ['verifier.run'])
    .filter((tool) => !isUnsafeTool(tool));

  return [{
    policyId: 'tool_loop_shadow_1',
    maxRepairAttempts: Math.max(0, Math.min(5, Math.round(
      baselinePolicy.maxRepairAttempts ?? (repairPressure ? 2 : 1),
    ))),
    maxSameToolRetries: Math.max(0, Math.min(4, Math.round(
      baselinePolicy.maxSameToolRetries ?? (retryPressure ? 2 : 1),
    ))),
    approvalEscalation: baselinePolicy.approvalEscalation || 'risky_tools',
    safeFallbackTools,
    status: 'shadow_only',
    sourceCaseIds,
    hardCaseReasons,
  }].slice(0, maxCandidates);
}

export function evaluateToolLoopPolicyCandidate({ candidate, traceCase } = {}) {
  const reasons = [];
  const unsafeFallbackTools = (candidate?.safeFallbackTools || []).filter(isUnsafeTool);
  if (unsafeFallbackTools.length) {
    reasons.push('unsafe_tool_expansion_denied');
    return {
      score: 0,
      reasons,
      safety: { status: 'denied', unsafeFallbackTools },
      promotable: false,
    };
  }

  if (traceCase?.reason === 'malformed_json_repair_failed' && (candidate?.maxRepairAttempts || 0) > 0) {
    reasons.push('json_repair_attempt_available');
  }
  if (traceCase?.recoveredByFallback && (candidate?.safeFallbackTools || []).length) {
    reasons.push('safe_fallback_recovered_trace');
  }
  if (traceCase?.reason === 'unknown_tool') {
    reasons.push('unknown_tool_escalates_to_safe_fallback');
  }

  const score = clamp(0.45 + (reasons.length * 0.15));
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

export async function runToolLoopPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'tool_loop_policy_bes',
  now,
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeToolLoopPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'tool',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (traceCase) => evaluateToolLoopPolicyCandidate({ candidate, traceCase }),
    }),
  });
}
