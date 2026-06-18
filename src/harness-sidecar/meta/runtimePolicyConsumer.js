export const MAX_ACTIONS_DELTA = 2;
export const MIN_MAX_ACTIONS_PER_TASK = 4;
export const MAX_MAX_ACTIONS_PER_TASK = 16;

export const ICR_CAPS_BY_LEVEL = Object.freeze({
  0: { branchBreadth: 1, correctionDepth: 2 },
  1: { branchBreadth: 2, correctionDepth: 4 },
  2: { branchBreadth: 4, correctionDepth: 8 },
  3: { branchBreadth: 5, correctionDepth: 10 },
  4: { branchBreadth: 5, correctionDepth: 10 },
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneHarnessConfig(harnessConfig = {}) {
  return structuredClone(harnessConfig);
}

export function resolveEffectiveAutonomyLevel(policy = {}, harnessConfig = {}) {
  const earnedLevel = Number(policy?.partialAutonomy?.level ?? 1);
  const maxLevel = Number(harnessConfig?.partialAutonomy?.maxLevel ?? 2);
  const safeEarned = Number.isFinite(earnedLevel) ? earnedLevel : 1;
  const safeMax = Number.isFinite(maxLevel) ? maxLevel : 2;
  return Math.max(0, Math.min(safeEarned, safeMax));
}

export function computeAdaptiveSearchActionDelta(aggregateScore) {
  const score = Number(aggregateScore);
  if (!Number.isFinite(score)) return 0;
  return clamp(Math.round(score * 10), -MAX_ACTIONS_DELTA, MAX_ACTIONS_DELTA);
}

function icrCapsForLevel(level) {
  return ICR_CAPS_BY_LEVEL[level] || ICR_CAPS_BY_LEVEL[2];
}

function applyAdaptiveSearchAdjustments(config, policy, effectiveLevel) {
  const adaptiveSearch = { ...asObject(config.adaptiveSearch) };
  const baseMaxActions = Number(adaptiveSearch.maxActionsPerTask ?? 8);
  const scoreDelta = computeAdaptiveSearchActionDelta(policy?.policyHints?.aggregateScore);
  const policyOverride = asObject(asObject(policy.harnessAdjustments).adaptiveSearch).maxActionsPerTask;

  let nextMaxActions = Number.isFinite(Number(policyOverride))
    ? Number(policyOverride)
    : baseMaxActions + scoreDelta;

  nextMaxActions = clamp(
    Number.isFinite(nextMaxActions) ? nextMaxActions : baseMaxActions,
    MIN_MAX_ACTIONS_PER_TASK,
    MAX_MAX_ACTIONS_PER_TASK,
  );

  if (effectiveLevel < 3 && Number.isFinite(Number(policyOverride))) {
    nextMaxActions = clamp(baseMaxActions + scoreDelta, MIN_MAX_ACTIONS_PER_TASK, MAX_MAX_ACTIONS_PER_TASK);
  }

  adaptiveSearch.maxActionsPerTask = nextMaxActions;
  config.adaptiveSearch = adaptiveSearch;
}

function applyIcrAdjustments(config, policy, effectiveLevel) {
  const icr = { ...asObject(config.icr) };
  const policyIcr = asObject(asObject(policy.harnessAdjustments).icr);
  const caps = icrCapsForLevel(effectiveLevel);

  const requestedBreadth = Number(
    policyIcr.branchBreadth ?? icr.branchBreadth ?? caps.branchBreadth,
  );
  const requestedDepth = Number(
    policyIcr.correctionDepth ?? icr.correctionDepth ?? caps.correctionDepth,
  );

  icr.branchBreadth = clamp(
    Number.isFinite(requestedBreadth) ? requestedBreadth : caps.branchBreadth,
    1,
    caps.branchBreadth,
  );
  icr.correctionDepth = clamp(
    Number.isFinite(requestedDepth) ? requestedDepth : caps.correctionDepth,
    1,
    caps.correctionDepth,
  );

  config.icr = icr;
}

export function applyRuntimePolicyToHarnessConfig(harnessConfig = {}, policy = {}) {
  const effectiveLevel = resolveEffectiveAutonomyLevel(policy, harnessConfig);
  const advisoryOnly = effectiveLevel < 3;
  const nextConfig = cloneHarnessConfig(harnessConfig);

  applyAdaptiveSearchAdjustments(nextConfig, policy, effectiveLevel);
  applyIcrAdjustments(nextConfig, policy, effectiveLevel);

  return {
    harnessConfig: nextConfig,
    advisoryOnly,
    autonomyLevel: effectiveLevel,
    evidenceOnly: advisoryOnly,
    canPromote: false,
    authority: advisoryOnly ? 'evidence_only' : 'reversible_runtime',
    adjustments: {
      adaptiveSearch: {
        maxActionsPerTask: nextConfig.adaptiveSearch?.maxActionsPerTask,
        deltaFromScore: computeAdaptiveSearchActionDelta(policy?.policyHints?.aggregateScore),
      },
      icr: {
        branchBreadth: nextConfig.icr?.branchBreadth,
        correctionDepth: nextConfig.icr?.correctionDepth,
        cappedByLevel: effectiveLevel,
      },
    },
  };
}
