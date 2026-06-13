const VISUAL_HARD_CASE_REASONS = new Set([
  'visual_false_positive',
  'visual_false_negative',
  'vlm_missed_artifact',
  'ocr_failure',
  'screenshot_diff_failure',
  'visual_evidence_failed',
  'prompt_injection_quarantined',
]);

import { runBesLaneRuntime } from '../bes/laneRuntime.js';
import { recommendBudgetAwareVlmRoute } from '../vlm/visualBenchmarkCases.js';

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
  return list.filter((traceCase = {}) => VISUAL_HARD_CASE_REASONS.has(traceCase.reason));
}

function visualCaseFor(traceCase = {}) {
  return traceCase.visualCase || traceCase.verifierCase?.visualCase || null;
}

function buildVlmRouting({ hardCases, baselinePolicy = {} }) {
  const routedCases = hardCases
    .map((traceCase) => {
      const visualCase = visualCaseFor(traceCase);
      if (!visualCase?.benchmarkKind) return null;
      const routing = recommendBudgetAwareVlmRoute({
        visualCase,
        budget: traceCase.budget || traceCase.visualBudget || {},
      });
      return {
        caseId: visualCase.caseId || traceCase.caseId,
        sourceCaseId: traceCase.caseId || traceCase.traceId || null,
        benchmarkKind: visualCase.benchmarkKind,
        decision: routing.decision,
        route: routing.route,
        budget: routing.budget,
        reasons: routing.reasons,
      };
    })
    .filter(Boolean);

  const routeByCaseKind = {
    ...(baselinePolicy.vlmRouting?.routeByCaseKind || {}),
  };
  for (const routedCase of routedCases) {
    routeByCaseKind[routedCase.benchmarkKind] = routedCase.route;
  }

  const hasDownshift = routedCases.some((routedCase) => routedCase.decision === 'downshift');
  const hasEscalation = routedCases.some((routedCase) => routedCase.decision === 'escalate');

  return {
    mode: 'budget_aware_shadow',
    budgetMode: hasDownshift ? 'downshift' : hasEscalation ? 'escalate' : 'standard',
    routeByCaseKind,
    cases: routedCases,
  };
}

export function proposeVisualPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const hardCases = normalizeCases(coreset);
  if (!hardCases.length || maxCandidates <= 0) return [];

  const falseNegative = hardCases.some((traceCase) => traceCase.reason === 'visual_false_negative');
  const falsePositive = hardCases.some((traceCase) => traceCase.reason === 'visual_false_positive');

  return [{
    policyId: 'visual_shadow_1',
    scoreThreshold: round(clamp((baselinePolicy.scoreThreshold ?? 0.78) + (falsePositive ? 0.05 : 0) - (falseNegative ? 0.05 : 0), 0.5, 0.95)),
    confidenceThreshold: round(clamp((baselinePolicy.confidenceThreshold ?? 0.7) - (falseNegative ? 0.05 : 0), 0.45, 0.9)),
    routes: {
      pdf: baselinePolicy.routes?.pdf || ['pdf', 'ocr'],
      ocr: baselinePolicy.routes?.ocr || ['ocr'],
      screenshot: baselinePolicy.routes?.screenshot || ['screenshot'],
      diff: baselinePolicy.routes?.diff || ['screenshot', 'diff'],
      chart: baselinePolicy.routes?.chart || ['chart', 'vlm_fast'],
      diagram: baselinePolicy.routes?.diagram || ['diagram', 'vlm_fast'],
      ui_regression: baselinePolicy.routes?.ui_regression || ['screenshot', 'diff'],
    },
    vlmRouting: buildVlmRouting({ hardCases, baselinePolicy }),
    status: 'shadow_only',
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    sourceCaseIds: hardCases.map((traceCase, index) => traceCase.caseId || traceCase.traceId || `case_${index + 1}`),
    hardCaseReasons: unique(hardCases.map((traceCase) => traceCase.reason)),
  }].slice(0, maxCandidates);
}

export function evaluateVisualPolicyCandidate({ candidate, visualCase } = {}) {
  const reasons = [];
  let score = 0.55;

  if (visualCase?.vlmPassed === true && visualCase?.artifactSupported === false) {
    reasons.push('vlm_only_without_artifact_support');
    score -= 0.3;
  }
  if ((visualCase?.artifactSupported === true || visualCase?.artifactChecksPassed === true) && visualCase?.vlmPassed !== false) {
    reasons.push('artifact_supported_visual_result');
    score += 0.25;
  }
  if ((candidate?.scoreThreshold || 1) <= 0.8 && visualCase?.reason === 'visual_false_negative') {
    reasons.push('false_negative_threshold_relaxed');
    score += 0.15;
  }

  return {
    score: round(clamp(score)),
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

export async function runVisualPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'visual_policy_bes',
  now,
  candidateOverrides = [],
} = {}) {
  const hardCases = laneCases(coreset);
  const proposalCoreset = { cases: hardCases, hardCases };
  const candidates = proposeVisualPolicies({ coreset: proposalCoreset, baselinePolicy, maxCandidates })
    .map((candidate, index) => ({ ...candidate, ...(candidateOverrides[index] || {}) }));

  return runBesLaneRuntime({
    lane: 'visual',
    taskId,
    candidates,
    hardCases,
    now,
    evaluator: ({ candidate }) => evaluateAcrossCases({
      candidate,
      hardCases,
      evaluate: (visualCase) => evaluateVisualPolicyCandidate({ candidate, visualCase }),
    }),
  });
}
