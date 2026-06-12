import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

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

function sanitizeEvidenceString(value, fallback = 'redacted') {
  const text = String(value ?? '').trim() || fallback;
  const quarantined = quarantineModelVisiblePayload(text, { maxStringLength: 256 });
  return String(quarantined.value || fallback)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(api[_-]?key|token|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function sanitizeProfileKey(value) {
  return sanitizeEvidenceString(value, 'model')
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'model';
}

function sanitizeRouterDefaults(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => sanitizeRouterDefaults(item, seen));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeEvidenceString(value) : value;
  }
  if (seen.has(value)) return '[redacted-cycle]';
  seen.add(value);

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const safeKey = sanitizeProfileKey(key);
    if (/api[_-]?key|token|secret|credential|authorization/i.test(key)) {
      return [safeKey, '[redacted]'];
    }
    return [safeKey, sanitizeRouterDefaults(child, seen)];
  }));
}

function groupedOutcomes(outcomes = []) {
  const groups = new Map();
  for (const outcome of asArray(outcomes)) {
    const modelProfile = sanitizeProfileKey(modelProfileOf(outcome));
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

  for (const [rawModelProfile, baselineWeight] of Object.entries(baselineWeights || {})) {
    const modelProfile = sanitizeProfileKey(rawModelProfile);
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
    calibrationId: sanitizeProfileKey(calibrationId || `ensemble-calibration-${suiteId || 'suite'}`),
    suiteId: suiteId ? sanitizeEvidenceString(suiteId) : null,
    modelWeights,
    confidenceIntervals,
    regressions,
    routerDefaultsSnapshot: routerDefaults ? sanitizeRouterDefaults(routerDefaults) : undefined,
    evidenceOnly: true,
    recommendedForPromotion: false,
  };
}
