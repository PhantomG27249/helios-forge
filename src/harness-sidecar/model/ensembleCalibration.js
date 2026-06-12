function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Number(clamp01(value).toFixed(6));
}

function confidenceInterval(successes, total) {
  if (total <= 0) return { lower: 0, upper: 0 };
  const p = successes / total;
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / total);
  return {
    lower: round(p - margin),
    upper: round(p + margin),
  };
}

function modelProfileOf(outcome = {}) {
  return String(outcome.modelProfile || outcome.model || outcome.endpointProfile || 'model').trim() || 'model';
}

function groupedOutcomes(outcomes = []) {
  const groups = new Map();
  for (const outcome of asArray(outcomes)) {
    const modelProfile = modelProfileOf(outcome);
    if (!groups.has(modelProfile)) groups.set(modelProfile, []);
    groups.get(modelProfile).push(outcome);
  }
  return groups;
}

export function calibrateModelEnsemble({
  calibrationId,
  suiteId,
  outcomes = [],
  minCases = 10,
  baselineWeights = {},
  routerDefaults,
} = {}) {
  const groups = groupedOutcomes(outcomes);
  const rates = {};
  const confidenceIntervals = {};
  const regressions = [];

  for (const [modelProfile, records] of groups.entries()) {
    const solved = records.filter((record) => record.solved === true || record.passed === true).length;
    rates[modelProfile] = records.length > 0 ? solved / records.length : 0;
    confidenceIntervals[modelProfile] = confidenceInterval(solved, records.length);
    if (records.length < minCases) {
      regressions.push({
        modelProfile,
        reason: 'minimum_case_count_not_met',
        caseCount: records.length,
        minCases,
      });
    }
  }

  const totalRate = Object.values(rates).reduce((sum, value) => sum + value, 0);
  const modelWeights = Object.fromEntries(Object.entries(rates)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelProfile, rate]) => [
      modelProfile,
      round(totalRate > 0 ? rate / totalRate : 1 / Math.max(1, groups.size)),
    ]));

  for (const [modelProfile, baselineWeight] of Object.entries(baselineWeights || {})) {
    if (Number(baselineWeight) > 0 && round(modelWeights[modelProfile] || 0) < round(baselineWeight)) {
      regressions.push({
        modelProfile,
        reason: 'baseline_model_weight_regressed',
        baselineWeight: round(baselineWeight),
        calibratedWeight: round(modelWeights[modelProfile] || 0),
      });
    }
  }

  return {
    calibrationId: calibrationId || `ensemble-calibration-${suiteId || 'suite'}`,
    suiteId: suiteId || null,
    modelWeights,
    confidenceIntervals,
    regressions,
    routerDefaultsSnapshot: routerDefaults ? JSON.parse(JSON.stringify(routerDefaults)) : undefined,
    evidenceOnly: true,
    recommendedForPromotion: false,
  };
}
