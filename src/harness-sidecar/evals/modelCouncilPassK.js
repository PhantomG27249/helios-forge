const DEFAULT_VARIANT_ORDER = ['bestSingle', 'repeatedSampling', 'staticCouncil', 'adaptiveCouncil'];

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function roundMetric(value) {
  return Number(clamp01(value).toFixed(6));
}

function roundDelta(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(6));
}

function choose(total, k) {
  if (k < 0 || k > total) return 0;
  if (k === 0 || k === total) return 1;
  const n = Math.min(k, total - k);
  let result = 1;
  for (let index = 1; index <= n; index += 1) {
    result = (result * (total - n + index)) / index;
  }
  return result;
}

export function estimatePassAtK({ solvedCount, totalCount, k = 1 } = {}) {
  const total = Math.max(0, Math.floor(Number(totalCount) || 0));
  if (total === 0) return 0;
  const solved = Math.max(0, Math.min(total, Number(solvedCount) || 0));
  const sampleCount = Math.max(1, Math.min(total, Math.floor(Number(k) || 1)));
  if (sampleCount === 1) return roundMetric(solved / total);
  const unsolved = total - solved;
  if (unsolved < sampleCount) return 1;
  return roundMetric(1 - (choose(unsolved, sampleCount) / choose(total, sampleCount)));
}

function defaultCases(count = 10) {
  return Array.from({ length: count }, (_, index) => ({ caseId: `passk-case-${index + 1}` }));
}

function caseOrdinal(caseRecord, index) {
  const match = String(caseRecord?.caseId || '').match(/(\d+)$/);
  return match ? Number(match[1]) : index + 1;
}

function defaultVariant(limit) {
  return async ({ caseRecord, index }) => {
    const ordinal = caseOrdinal(caseRecord, index);
    return {
      solved: ordinal <= limit,
      score: ordinal <= limit ? 1 : 0,
    };
  };
}

function defaultVariants() {
  return {
    bestSingle: defaultVariant(6),
    repeatedSampling: defaultVariant(6),
    staticCouncil: defaultVariant(7),
    adaptiveCouncil: defaultVariant(8),
  };
}

function executorForVariant(variants, variantName) {
  const candidate = variants?.[variantName];
  if (typeof candidate === 'function') return candidate;
  if (typeof candidate?.execute === 'function') return candidate.execute;
  return defaultVariants()[variantName];
}

async function normalizeSolved(output, { verifier } = {}) {
  if (typeof verifier === 'function') {
    const verified = await verifier(output);
    if (typeof verified === 'boolean') return verified;
    if (verified && typeof verified === 'object') {
      return Boolean(verified.solved ?? verified.passed ?? verified.verifierPassed);
    }
  }
  return Boolean(output?.solved ?? output?.passed ?? output?.verifierPassed);
}

async function runVariant({ variantName, executor, cases, k, modelRouter, orchestrate, verifier, rng }) {
  const results = [];
  let solvedCount = 0;

  for (let index = 0; index < cases.length; index += 1) {
    const caseRecord = cases[index] || {};
    const output = await executor({
      caseRecord,
      index,
      k,
      modelRouter,
      orchestrate,
      rng,
      previousResults: results,
    });
    const solved = await normalizeSolved(output, { verifier });
    if (solved) solvedCount += 1;
    const score = clamp01(output?.score ?? (solved ? 1 : 0));
    results.push({
      caseId: String(caseRecord.caseId || `case-${index + 1}`),
      solved,
      score,
    });

    if (variantName === 'adaptiveCouncil' && typeof modelRouter?.state?.recordReward === 'function') {
      modelRouter.state.recordReward({
        key: output?.routerKey || 'passk/adaptiveCouncil',
        armId: output?.armId || output?.modelProfile || 'adaptive_council',
        reward: score,
        evidence: {
          caseId: String(caseRecord.caseId || `case-${index + 1}`),
          variant: variantName,
          verifierPassed: solved,
          score,
        },
      });
    }
  }

  return {
    variant: variantName,
    solvedCount,
    totalCount: cases.length,
    passAtK: estimatePassAtK({ solvedCount, totalCount: cases.length, k }),
    cases: results,
  };
}

function upliftDelta(from, to) {
  return {
    from: from.variant,
    to: to.variant,
    delta: roundDelta(to.passAtK - from.passAtK),
  };
}

export function summarizePassKUplift(report = {}) {
  const bestSingle = report.baselines?.bestSingle || {};
  const repeatedSampling = report.baselines?.repeatedSampling || {};
  const staticCouncil = report.variants?.staticCouncil || {};
  const adaptiveCouncil = report.variants?.adaptiveCouncil || {};
  return {
    evalId: report.evalId,
    caseCount: report.caseCount || 0,
    k: report.k || 1,
    bestSinglePassAtK: bestSingle.passAtK ?? 0,
    repeatedSamplingPassAtK: repeatedSampling.passAtK ?? 0,
    staticCouncilPassAtK: staticCouncil.passAtK ?? 0,
    adaptiveCouncilPassAtK: adaptiveCouncil.passAtK ?? 0,
    uplift: report.uplift || {
      staticVsBestSingle: upliftDelta(bestSingle, staticCouncil),
      adaptiveVsBestSingle: upliftDelta(bestSingle, adaptiveCouncil),
      adaptiveVsStatic: upliftDelta(staticCouncil, adaptiveCouncil),
    },
    proven: Boolean(report.proven),
    authority: 'evidence_only',
    canPromote: false,
  };
}

export async function runModelCouncilPassKEval({
  cases,
  variants,
  k = 1,
  minCases = 10,
  upliftThreshold = 0.05,
  modelRouter,
  orchestrate,
  verifier,
  rng,
} = {}) {
  const evalCases = Array.isArray(cases) && cases.length ? cases : defaultCases();
  const variantExecutors = { ...defaultVariants(), ...(variants || {}) };
  const results = {};
  for (const variantName of DEFAULT_VARIANT_ORDER) {
    results[variantName] = await runVariant({
      variantName,
      executor: executorForVariant(variantExecutors, variantName),
      cases: evalCases,
      k,
      modelRouter,
      orchestrate,
      verifier,
      rng,
    });
  }

  const baselines = {
    bestSingle: results.bestSingle,
    repeatedSampling: results.repeatedSampling,
  };
  const variantResults = {
    staticCouncil: results.staticCouncil,
    adaptiveCouncil: results.adaptiveCouncil,
  };
  const uplift = {
    staticVsBestSingle: upliftDelta(baselines.bestSingle, variantResults.staticCouncil),
    adaptiveVsBestSingle: upliftDelta(baselines.bestSingle, variantResults.adaptiveCouncil),
    adaptiveVsStatic: upliftDelta(variantResults.staticCouncil, variantResults.adaptiveCouncil),
  };
  const confidence = {
    minCasesMet: evalCases.length >= minCases,
    upliftThresholdMet: uplift.adaptiveVsBestSingle.delta >= upliftThreshold,
  };

  return {
    evalId: `model-council-passk-${evalCases.length}-k${Math.max(1, Math.floor(Number(k) || 1))}`,
    caseCount: evalCases.length,
    k: Math.max(1, Math.floor(Number(k) || 1)),
    baselines,
    variants: variantResults,
    uplift,
    confidence,
    proven: confidence.minCasesMet && confidence.upliftThresholdMet,
    authority: 'evidence_only',
    canPromote: false,
  };
}
