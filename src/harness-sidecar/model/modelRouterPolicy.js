import { createModelRouterState } from './modelRouterState.js';

const DEFAULT_EXPLORATION_FLOOR = 0.05;
const DEFAULT_MAX_ARMS = 8;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, limit = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function defaultRng() {
  return Math.random();
}

function normalSample(rng = defaultRng) {
  const u1 = Math.max(Number.EPSILON, clamp01(rng()));
  const u2 = Math.max(Number.EPSILON, clamp01(rng()));
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gammaSample(shape, rng = defaultRng) {
  const alpha = Math.max(0.000001, Number(shape) || 1);
  if (alpha < 1) {
    const u = Math.max(Number.EPSILON, clamp01(rng()));
    return gammaSample(alpha + 1, rng) * (u ** (1 / alpha));
  }

  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempts = 0; attempts < 64; attempts += 1) {
    const x = normalSample(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = clamp01(rng());
    if (u < 1 - 0.0331 * (x ** 4)) return d * v;
    if (Math.log(Math.max(Number.EPSILON, u)) < 0.5 * (x ** 2) + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
  return alpha;
}

function armIsEligible(arm = {}) {
  if (!arm || typeof arm !== 'object') return false;
  if (arm.safetyBlocked === true || arm.safety === 'blocked') return false;
  if (arm.unhealthy === true || arm.healthy === false) return false;
  if (['unhealthy', 'blocked', 'down'].includes(boundedString(arm.health).toLowerCase())) return false;
  if (['unhealthy', 'blocked', 'down'].includes(boundedString(arm.status).toLowerCase())) return false;
  return true;
}

function normalizeArm(arm = {}, role) {
  if (!isPlainObject(arm)) return null;
  const modelProfile = boundedString(arm.modelProfile ?? arm.profile ?? arm.model);
  const endpointProfile = boundedString(arm.endpointProfile);
  const armId = boundedString(arm.armId ?? modelProfile ?? endpointProfile);
  if (!armId) return null;
  return {
    armId,
    role: boundedString(arm.role) || boundedString(role) || undefined,
    modelProfile: modelProfile || armId,
    endpointProfile: endpointProfile || undefined,
    safetyBlocked: arm.safetyBlocked === true,
    health: boundedString(arm.health) || undefined,
    status: boundedString(arm.status) || undefined,
    unhealthy: arm.unhealthy === true,
    healthy: typeof arm.healthy === 'boolean' ? arm.healthy : undefined,
  };
}

function dedupeArms(arms) {
  const byId = new Map();
  for (const arm of arms) {
    if (!arm || byId.has(arm.armId)) continue;
    byId.set(arm.armId, arm);
  }
  return [...byId.values()];
}

export function sampleBeta({ alpha = 1, beta = 1, rng = defaultRng } = {}) {
  const x = gammaSample(alpha, rng);
  const y = gammaSample(beta, rng);
  const total = x + y;
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return clamp01(x / total);
}

export function normalizeRouterArms({ council, role, taskContext } = {}) {
  const normalized = [];
  const safeRole = boundedString(role);

  const roleRoute = safeRole ? council?.roleRoutes?.[safeRole] : null;
  if (roleRoute) {
    const arm = normalizeArm({ ...roleRoute, role: safeRole }, safeRole);
    if (arm) normalized.push(arm);
  } else if (isPlainObject(council?.roleRoutes)) {
    for (const [routeRole, route] of Object.entries(council.roleRoutes)) {
      if (safeRole && routeRole !== safeRole) continue;
      const arm = normalizeArm({ ...route, role: routeRole }, routeRole);
      if (arm) normalized.push(arm);
    }
  }

  const contextArms = Array.isArray(taskContext?.routerArms) ? taskContext.routerArms : [];
  for (const rawArm of contextArms) {
    if (safeRole && boundedString(rawArm?.role) && boundedString(rawArm.role) !== safeRole) continue;
    const arm = normalizeArm(rawArm, safeRole);
    if (arm) normalized.push(arm);
  }

  return dedupeArms(normalized).map((arm) => {
    const output = {
      armId: arm.armId,
      role: arm.role,
      modelProfile: arm.modelProfile,
    };
    if (arm.endpointProfile) output.endpointProfile = arm.endpointProfile;
    return output;
  });
}

export function createModelRouterPolicy({
  state = createModelRouterState(),
  rng = defaultRng,
  explorationFloor = DEFAULT_EXPLORATION_FLOOR,
  maxArmsPerDecision = DEFAULT_MAX_ARMS,
} = {}) {
  const safeExplorationFloor = clamp01(explorationFloor);
  const safeMaxArms = Math.max(1, Math.floor(Number(maxArmsPerDecision) || DEFAULT_MAX_ARMS));
  let decisionCount = 0;

  return {
    selectArm({ key, role, arms, council, taskContext } = {}) {
      const rawArms = Array.isArray(arms) ? arms : normalizeRouterArms({ council, role, taskContext });
      const eligible = dedupeArms(rawArms.map((arm) => normalizeArm(arm, role)).filter(armIsEligible));
      if (eligible.length === 0) return null;

      const scored = eligible.map((arm) => {
        const posterior = state.getArm({ key, armId: arm.armId }) || {
          alpha: 1,
          beta: 1,
          observations: 0,
        };
        const sampled = sampleBeta({ alpha: posterior.alpha, beta: posterior.beta, rng });
        return {
          ...arm,
          sampledValue: Math.max(safeExplorationFloor, sampled),
          rawSampledValue: sampled,
          posterior: {
            alpha: posterior.alpha,
            beta: posterior.beta,
            observations: posterior.observations,
          },
        };
      });

      const selectionPool = [...scored]
        .sort((a, b) => b.sampledValue - a.sampledValue)
        .slice(0, safeMaxArms);
      const selected = selectionPool[0] || scored[0];
      const alternatives = scored
        .sort((a, b) => b.sampledValue - a.sampledValue)
        .map((arm) => ({
          armId: arm.armId,
          modelProfile: arm.modelProfile,
          endpointProfile: arm.endpointProfile,
          sampledValue: arm.sampledValue,
          observations: arm.posterior.observations,
        }));

      return {
        type: 'model_router.arm_selected',
        authority: 'evidence_only',
        canPromote: false,
        key,
        actionId: `model_router:${boundedString(role) || 'unknown'}:${selected.armId}:${decisionCount += 1}`,
        role: boundedString(role) || selected.role,
        armId: selected.armId,
        modelProfile: selected.modelProfile,
        endpointProfile: selected.endpointProfile,
        sampledValue: selected.sampledValue,
        posterior: selected.posterior,
        alternatives,
      };
    },
  };
}
