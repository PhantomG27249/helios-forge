const RESEARCH_HARD_CASE_REASONS = new Set([
  'unsupported_claim',
  'contradiction_missed',
  'figure_only_evidence',
  'source_grounding_missing',
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
  return list.filter((traceCase = {}) => RESEARCH_HARD_CASE_REASONS.has(traceCase.reason));
}

export function proposeResearchPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const contradictionPressure = hardCases.some((traceCase) => traceCase.reason === 'contradiction_missed');
  const figureRisk = hardCases.some((traceCase) => traceCase.reason === 'figure_only_evidence');

  return [{
    policyId: 'research_shadow_1',
    sourceGroundingWeight: round(clamp((baselinePolicy.sourceGroundingWeight ?? 0.65) + 0.1)),
    contradictionCheckWeight: round(clamp((baselinePolicy.contradictionCheckWeight ?? 0.25) + (contradictionPressure ? 0.2 : 0.05))),
    figureEvidencePenalty: round(clamp((baselinePolicy.figureEvidencePenalty ?? 0.2) + (figureRisk ? 0.15 : 0.05))),
    claimExtractionStrictness: baselinePolicy.claimExtractionStrictness || 'evidence_span_required',
    reportTemplate: baselinePolicy.reportTemplate === 'evidence_first' ? 'evidence_first' : 'evidence_first',
    status: 'shadow_only',
    sourceCaseIds: hardCases.map((traceCase, index) => traceCase.caseId || traceCase.traceId || `case_${index + 1}`),
    hardCaseReasons: unique(hardCases.map((traceCase) => traceCase.reason)),
  }].slice(0, maxCandidates);
}

export function evaluateResearchPolicyCandidate({ candidate, researchCase } = {}) {
  const reasons = [];
  const supported = Number(researchCase?.supportedClaims || 0);
  const unsupported = Number(researchCase?.unsupportedClaims || 0);
  const figureOnly = Number(researchCase?.figureOnlyClaims || 0);
  const contradictionMisses = Number(researchCase?.contradictionMisses || 0);
  const totalClaims = Math.max(1, supported + unsupported + figureOnly);

  if (supported / totalClaims >= 0.6) {
    reasons.push('source_grounded_evidence_rewarded');
  }
  if (unsupported > 0) {
    reasons.push('unsupported_claim_penalized');
  }
  if (figureOnly > 0) {
    reasons.push('figure_only_evidence_penalized');
  }
  if (contradictionMisses > 0) {
    reasons.push('contradiction_miss_penalized');
  }

  const score = round(clamp(
    0.35
      + (supported / totalClaims) * (candidate?.sourceGroundingWeight ?? 0.6)
      - unsupported * 0.08
      - figureOnly * (candidate?.figureEvidencePenalty ?? 0.2)
      - contradictionMisses * (candidate?.contradictionCheckWeight ?? 0.25),
  ));

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

export async function runResearchPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'research_policy_bes',
  now,
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeResearchPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'research',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (researchCase) => evaluateResearchPolicyCandidate({ candidate, researchCase }),
    }),
  });
}
