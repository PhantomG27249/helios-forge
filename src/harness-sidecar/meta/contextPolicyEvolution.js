const CONTEXT_HARD_CASE_REASONS = new Set([
  'missing_context',
  'rag_miss',
  'retrieval_gap',
  'context_noise',
  'insufficient_context',
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
  return list.filter((traceCase = {}) => CONTEXT_HARD_CASE_REASONS.has(traceCase.reason));
}

function normalizeWeight(value, fallback) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
}

function basePolicy(baselinePolicy = {}) {
  return {
    lexicalWeight: normalizeWeight(baselinePolicy.lexicalWeight, 0.35),
    graphWeight: normalizeWeight(baselinePolicy.graphWeight, 0.25),
    memoryWeight: normalizeWeight(baselinePolicy.memoryWeight, 0.25),
    recentTraceWeight: normalizeWeight(baselinePolicy.recentTraceWeight, 0.15),
    maxContextItems: Math.max(1, Math.min(24, Math.round(baselinePolicy.maxContextItems || 8))),
    maxTokens: Math.max(1000, Math.min(32000, Math.round(baselinePolicy.maxTokens || 12000))),
  };
}

function candidateFrom(base, overrides, index, hardCases) {
  return {
    policyId: `context_shadow_${index + 1}`,
    ...base,
    ...overrides,
    status: 'shadow_only',
    sourceCaseIds: hardCases.map((traceCase, caseIndex) => traceCase.caseId || traceCase.traceId || `case_${caseIndex + 1}`),
    hardCaseReasons: unique(hardCases.map((traceCase) => traceCase.reason)),
  };
}

export function proposeContextPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const base = basePolicy(baselinePolicy);
  const wantsGraph = hardCases.some((traceCase) => /graph|relationship|rag/i.test(`${traceCase.reason} ${traceCase.expectedSource || ''}`));
  const wantsMemory = hardCases.some((traceCase) => /memory|prior|missing_context/i.test(`${traceCase.reason} ${traceCase.expectedSource || ''}`));
  const noisy = hardCases.some((traceCase) => traceCase.reason === 'context_noise' || traceCase.noiseRatio > 0.35);

  const variants = [
    {
      lexicalWeight: round(base.lexicalWeight),
      graphWeight: round(clamp(base.graphWeight + (wantsGraph ? 0.2 : 0.1))),
      memoryWeight: round(clamp(base.memoryWeight + (wantsMemory ? 0.2 : 0.1))),
      recentTraceWeight: round(base.recentTraceWeight),
      maxContextItems: noisy ? Math.max(3, base.maxContextItems - 2) : Math.min(12, base.maxContextItems + 2),
      maxTokens: noisy ? Math.max(2000, base.maxTokens - 2000) : Math.min(16000, base.maxTokens + 2000),
    },
    {
      lexicalWeight: round(clamp(base.lexicalWeight + 0.15)),
      graphWeight: round(base.graphWeight),
      memoryWeight: round(base.memoryWeight),
      recentTraceWeight: round(clamp(base.recentTraceWeight + 0.1)),
      maxContextItems: base.maxContextItems,
      maxTokens: base.maxTokens,
    },
  ];

  return variants
    .slice(0, Math.max(1, maxCandidates))
    .map((variant, index) => candidateFrom(base, variant, index, hardCases));
}

export function evaluateContextPolicyCandidate({ candidate, traceCase } = {}) {
  const requiredItems = Math.max(1, Number(traceCase?.requiredItems || traceCase?.expectedItems || 1));
  const relevantItems = Math.max(0, Number(traceCase?.relevantItems || 0));
  const noisyItems = Math.max(0, Number(traceCase?.noisyItems || 0));
  const totalItems = Math.max(1, relevantItems + noisyItems);
  const coverage = clamp(relevantItems / requiredItems);
  const noiseRatio = clamp(noisyItems / totalItems);
  const reasons = [];

  if (coverage >= 0.8) reasons.push('relevant_context_recovered');
  if (noiseRatio >= 0.35) reasons.push('context_noise_penalty');
  if ((candidate?.maxContextItems || 0) > 16 || (candidate?.maxTokens || 0) > 24000) {
    reasons.push('context_budget_pressure');
  }

  const score = round(clamp(0.2 + (coverage * 0.75) - (noiseRatio * 0.45)));
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

export async function runContextPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'context_policy_bes',
  now,
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeContextPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'context',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (traceCase) => evaluateContextPolicyCandidate({ candidate, traceCase }),
    }),
  });
}
