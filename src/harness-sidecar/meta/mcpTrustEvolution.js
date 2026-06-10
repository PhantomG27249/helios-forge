const MCP_HARD_CASE_REASONS = new Set([
  'suspicious_mcp_output',
  'mcp_poisoning_detected',
  'capability_startup_failed',
  'trust_tier_too_low',
  'unexpected_write_scope',
]);

import { runBesLaneRuntime } from '../bes/laneRuntime.js';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCases(coreset = []) {
  const list = Array.isArray(coreset) ? coreset : coreset.cases || coreset.hardCases || [];
  return list.filter((traceCase = {}) => MCP_HARD_CASE_REASONS.has(traceCase.reason));
}

function hasWriteScopeApproval(approvals = []) {
  return approvals.some((approval = {}) => (
    approval.allowWriteScopeExpansion === true
      || approval.approveWriteScopeExpansion === true
      || approval.scopeOverride === true
  ));
}

export function proposeMcpTrustPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const quarantineServers = unique(hardCases
    .filter((traceCase) => ['suspicious_mcp_output', 'mcp_poisoning_detected'].includes(traceCase.reason))
    .map((traceCase) => traceCase.serverId));
  const trustAdjustments = {};
  for (const traceCase of hardCases) {
    if (traceCase.reason === 'capability_startup_failed' && traceCase.serverId) {
      trustAdjustments[traceCase.serverId] = 'lower';
    }
  }

  return [{
    policyId: 'mcp_trust_shadow_1',
    minRiskyTrustTier: baselinePolicy.minRiskyTrustTier || 'verified',
    quarantineServers,
    trustAdjustments,
    writeScopeExpansions: [],
    status: 'shadow_only',
    sourceCaseIds: hardCases.map((traceCase, index) => traceCase.caseId || traceCase.traceId || `case_${index + 1}`),
    hardCaseReasons: unique(hardCases.map((traceCase) => traceCase.reason)),
  }].slice(0, maxCandidates);
}

export function evaluateMcpTrustPolicyCandidate({
  candidate,
  mcpCase = {},
  approvals = [],
} = {}) {
  const reasons = [];
  const writeScopeExpansions = candidate?.writeScopeExpansions || [];
  if (writeScopeExpansions.length && !hasWriteScopeApproval(approvals)) {
    reasons.push('write_scope_expansion_requires_approval');
    return {
      score: 0,
      reasons,
      safety: { status: 'human_required', writeScopeExpansions },
      promotable: false,
    };
  }
  if (writeScopeExpansions.length) {
    reasons.push('write_scope_expansion_approved');
  }

  if ((candidate?.quarantineServers || []).includes(mcpCase.serverId)) {
    reasons.push('server_quarantined');
  }
  if (candidate?.trustAdjustments?.[mcpCase.serverId] === 'lower') {
    reasons.push('trust_tier_lowered_after_startup_failure');
  }

  return {
    score: Math.min(1, 0.45 + (reasons.length * 0.2)),
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
    safety: results.find((result) => result.safety?.status === 'human_required')?.safety
      || results.find((result) => result.safety)?.safety
      || { status: 'shadow_only' },
    promotable: false,
  };
}

export async function runMcpTrustPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'mcp_trust_policy_bes',
  now,
  approvals = [],
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeMcpTrustPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'mcp_trust',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (mcpCase) => evaluateMcpTrustPolicyCandidate({ candidate, mcpCase, approvals }),
    }),
  });
}
