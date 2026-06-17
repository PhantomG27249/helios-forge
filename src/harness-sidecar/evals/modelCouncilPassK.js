const DEFAULT_VARIANT_ORDER = ['bestSingle', 'repeatedSampling', 'staticCouncil', 'adaptiveCouncil', 'calibratedEnsemble'];

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
    calibratedEnsemble: defaultVariant(8),
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

function confidenceInterval(result = {}) {
  const total = Number(result.totalCount || 0);
  if (total <= 0) return { lower: 0, upper: 0 };
  const p = Number(result.passAtK || 0);
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / total);
  return {
    lower: roundMetric(p - margin),
    upper: roundMetric(p + margin),
  };
}

function buildConfidenceIntervals(results = {}) {
  return Object.fromEntries(Object.entries(results).map(([name, result]) => [name, confidenceInterval(result)]));
}

function regressionEvidence({ evalCases, minCases, baselines, variants } = {}) {
  const regressions = [];
  if (evalCases.length < minCases) {
    regressions.push({
      reason: 'minimum_case_count_not_met',
      caseCount: evalCases.length,
      minCases,
    });
  }
  if ((variants.adaptiveCouncil?.passAtK || 0) < (baselines.bestSingle?.passAtK || 0)) {
    regressions.push({
      reason: 'adaptive_below_best_single',
      adaptiveCouncilPassAtK: variants.adaptiveCouncil?.passAtK || 0,
      bestSinglePassAtK: baselines.bestSingle?.passAtK || 0,
    });
  }
  if ((variants.calibratedEnsemble?.passAtK || 0) < (variants.staticCouncil?.passAtK || 0)) {
    regressions.push({
      reason: 'calibrated_below_static_council',
      calibratedEnsemblePassAtK: variants.calibratedEnsemble?.passAtK || 0,
      staticCouncilPassAtK: variants.staticCouncil?.passAtK || 0,
    });
  }
  return regressions;
}

export function summarizePassKUplift(report = {}) {
  const bestSingle = report.baselines?.bestSingle || {};
  const repeatedSampling = report.baselines?.repeatedSampling || {};
  const staticCouncil = report.variants?.staticCouncil || {};
  const adaptiveCouncil = report.variants?.adaptiveCouncil || {};
  const calibratedEnsemble = report.variants?.calibratedEnsemble || {};
  return {
    evalId: report.evalId,
    caseCount: report.caseCount || 0,
    k: report.k || 1,
    bestSinglePassAtK: bestSingle.passAtK ?? 0,
    repeatedSamplingPassAtK: repeatedSampling.passAtK ?? 0,
    staticCouncilPassAtK: staticCouncil.passAtK ?? 0,
    adaptiveCouncilPassAtK: adaptiveCouncil.passAtK ?? 0,
    calibratedEnsemblePassAtK: calibratedEnsemble.passAtK ?? 0,
    calibratedEnsembleConfidenceInterval: report.confidenceIntervals?.calibratedEnsemble || { lower: 0, upper: 0 },
    regressions: Array.isArray(report.regressions) ? report.regressions : [],
    regressionCount: Array.isArray(report.regressions) ? report.regressions.length : 0,
    uplift: report.uplift || {
      staticVsBestSingle: upliftDelta(bestSingle, staticCouncil),
      adaptiveVsBestSingle: upliftDelta(bestSingle, adaptiveCouncil),
      adaptiveVsStatic: upliftDelta(staticCouncil, adaptiveCouncil),
      calibratedVsBestSingle: upliftDelta(bestSingle, calibratedEnsemble),
      calibratedVsStatic: upliftDelta(staticCouncil, calibratedEnsemble),
    },
    proven: Boolean(report.proven),
    authority: 'evidence_only',
    canPromote: false,
  };
}

export async function runModelCouncilPassKEval({
  suiteId,
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
    calibratedEnsemble: results.calibratedEnsemble,
  };
  const uplift = {
    staticVsBestSingle: upliftDelta(baselines.bestSingle, variantResults.staticCouncil),
    adaptiveVsBestSingle: upliftDelta(baselines.bestSingle, variantResults.adaptiveCouncil),
    adaptiveVsStatic: upliftDelta(variantResults.staticCouncil, variantResults.adaptiveCouncil),
    calibratedVsBestSingle: upliftDelta(baselines.bestSingle, variantResults.calibratedEnsemble),
    calibratedVsStatic: upliftDelta(variantResults.staticCouncil, variantResults.calibratedEnsemble),
  };
  const confidence = {
    minCasesMet: evalCases.length >= minCases,
    upliftThresholdMet: uplift.adaptiveVsBestSingle.delta >= upliftThreshold,
  };

  const confidenceIntervals = buildConfidenceIntervals(results);
  const regressions = regressionEvidence({
    evalCases,
    minCases,
    baselines,
    variants: variantResults,
  });

  return {
    evalId: `model-council-passk-${evalCases.length}-k${Math.max(1, Math.floor(Number(k) || 1))}`,
    suiteId: suiteId || evalCases.find((caseRecord) => caseRecord?.suiteId)?.suiteId || null,
    caseCount: evalCases.length,
    k: Math.max(1, Math.floor(Number(k) || 1)),
    baselines,
    variants: variantResults,
    uplift,
    confidence,
    confidenceIntervals,
    regressions,
    proven: confidence.minCasesMet && confidence.upliftThresholdMet && regressions.length === 0,
    authority: 'evidence_only',
    canPromote: false,
    recommendedForPromotion: false,
  };
}

function evidenceOnlyPassKReport(report = {}) {
  return {
    ...report,
    authority: 'evidence_only',
    canPromote: false,
    recommendedForPromotion: false,
  };
}

function evidenceOnlyCalibration(calibration = {}) {
  return {
    ...calibration,
    evidenceOnly: true,
    canPromote: false,
    recommendedForPromotion: false,
  };
}

export function buildProductionPassKReport({
  report = {},
  gate = {},
  calibration = null,
} = {}) {
  const summary = summarizePassKUplift(report);
  const gateEnabled = gate.enabled === true;
  return {
    evidenceType: 'modelCouncilCalibration',
    gateName: 'ensembleCalibration',
    evidenceOnly: true,
    promotionEvidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
    gate: {
      name: 'ensembleCalibration',
      enabled: gateEnabled,
      mode: gate.mode || 'offline',
      authority: 'evidence_only',
    },
    summary: {
      ...summary,
      suiteId: report.suiteId || null,
      available: gateEnabled,
      itemCount: 1,
      proven: Boolean(report.proven),
      regressionCount: summary.regressionCount ?? 0,
    },
    passKReport: evidenceOnlyPassKReport(report),
    calibration: calibration ? evidenceOnlyCalibration(calibration) : null,
  };
}
