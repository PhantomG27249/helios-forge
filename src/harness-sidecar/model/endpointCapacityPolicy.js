import { normalizeEndpointProfiles } from './modelEndpointProfiles.js';
import { normalizeVllmHealthSnapshot } from './vllmHealthController.js';

const AUTHORITY = 'evidence_only';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, limit = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values = [], limit = 96) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => boundedString(value, limit))
    .filter(Boolean))];
}

function endpointEntries(endpoints) {
  if (Array.isArray(endpoints)) {
    return Object.fromEntries(endpoints
      .map((endpoint, index) => {
        const endpointProfile = boundedString(
          endpoint?.endpointProfile ?? endpoint?.profileId ?? endpoint?.id ?? `endpoint-${index + 1}`,
          96,
        );
        return endpointProfile ? [endpointProfile, endpoint] : null;
      })
      .filter(Boolean));
  }
  return isPlainObject(endpoints) ? endpoints : {};
}

function normalizeRoutes(routes) {
  if (!isPlainObject(routes)) return {};
  return Object.fromEntries(Object.entries(routes)
    .map(([role, endpointProfile]) => [
      boundedString(role, 96),
      boundedString(endpointProfile, 96),
    ])
    .filter(([role, endpointProfile]) => role && endpointProfile));
}

function normalizeHealthByEndpoint(routerHealth = {}) {
  if (!isPlainObject(routerHealth)) return {};
  return Object.fromEntries(Object.entries(routerHealth)
    .map(([endpointProfile, snapshot]) => [
      boundedString(endpointProfile, 96),
      normalizeVllmHealthSnapshot(snapshot),
    ])
    .filter(([endpointProfile]) => endpointProfile));
}

function action(base) {
  return {
    authority: AUTHORITY,
    canPromote: false,
    recommendationOnly: true,
    canProcure: false,
    ...base,
  };
}

function actionKey(item) {
  return [
    item.type,
    item.role,
    item.endpointProfile,
    item.modelProfile,
    item.reason,
  ].filter(Boolean).join(':');
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const key = actionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function costCeiling({ policy = {}, budget = {} } = {}) {
  const candidates = [
    finiteNumber(budget.maxEstimatedCostUsdPer1kTokens),
    finiteNumber(policy.maxEstimatedCostUsdPer1kTokens),
  ].filter((value) => value !== null && value >= 0);
  return candidates.length ? Math.min(...candidates) : null;
}

function latencyCeiling({ policy = {} } = {}) {
  const ceiling = finiteNumber(policy.maxP95LatencyMs);
  return ceiling !== null && ceiling >= 0 ? ceiling : null;
}

function endpointSupportsVision(endpoint = {}) {
  if (endpoint.supportsVision === true) return true;
  if (endpoint.supportsVision === false) return false;
  return Array.isArray(endpoint.capabilities) && endpoint.capabilities.includes('image');
}

function routeRequiresVision({ role, policy = {} }) {
  const roleRequirement = isPlainObject(policy.routeRequirements)
    ? policy.routeRequirements[role]
    : null;
  if (roleRequirement?.requiresVision === true) return true;
  return uniqueStrings(policy.visionRoles).includes(role);
}

function blockedRoute({ endpointProfile, blockedReasons }) {
  return {
    endpointProfile,
    allowed: blockedReasons.length === 0,
    blockedReasons,
  };
}

export function recommendEndpointCapacityActions({
  endpoints,
  routerHealth,
  policy = {},
  budget = {},
} = {}) {
  const normalizedEndpoints = normalizeEndpointProfiles(endpointEntries(endpoints));
  const normalizedHealth = normalizeHealthByEndpoint(routerHealth);
  const routes = normalizeRoutes(policy.routes);
  const requiredSpecialists = uniqueStrings(policy.requiredSpecialists);
  const requiredModelProfiles = uniqueStrings(policy.requiredModelProfiles, 256);
  const maxCost = costCeiling({ policy, budget });
  const maxLatency = latencyCeiling({ policy });
  const actions = [];
  const routeRecommendations = {};

  if (policy.autoProcurementEnabled === true) {
    actions.push(action({
      type: 'model_endpoint.auto_procurement_disabled',
      action: 'recommend_manual_capacity_review',
      reason: 'auto_procurement_disabled',
    }));
  }

  for (const [endpointProfile, endpoint] of Object.entries(normalizedEndpoints)) {
    const health = normalizedHealth[endpointProfile] || {};
    if (health.healthy === false) {
      actions.push(action({
        type: 'endpoint.degraded',
        action: 'reduce_or_pause_endpoint',
        endpointProfile,
        modelId: endpoint.modelId,
        reason: health.reason || 'health_probe_failed',
        evidence: health,
      }));
    }
  }

  for (const role of requiredSpecialists) {
    if (!routes[role]) {
      actions.push(action({
        type: 'model_endpoint.missing_specialist_route',
        action: 'recommend_specialist_route',
        role,
        reason: 'missing_specialist_route',
      }));
      routeRecommendations[role] = blockedRoute({
        endpointProfile: null,
        blockedReasons: ['missing_specialist_route'],
      });
    }
  }

  for (const [role, endpointProfile] of Object.entries(routes)) {
    const endpoint = normalizedEndpoints[endpointProfile];
    const health = normalizedHealth[endpointProfile] || {};
    const blockedReasons = [];

    if (!endpoint) {
      blockedReasons.push('missing_specialist_endpoint');
      actions.push(action({
        type: 'model_endpoint.missing_specialist_endpoint',
        action: 'recommend_endpoint_profile',
        role,
        endpointProfile,
        reason: 'missing_specialist_endpoint',
      }));
    } else {
      if (health.healthy === false) {
        blockedReasons.push(health.reason || 'health_probe_failed');
      }

      if (
        maxCost !== null
        && Number.isFinite(endpoint.estimatedCostUsdPer1kTokens)
        && endpoint.estimatedCostUsdPer1kTokens > maxCost
      ) {
        blockedReasons.push('cost_ceiling_exceeded');
        actions.push(action({
          type: 'model_endpoint.cost_ceiling_exceeded',
          action: 'recommend_downshift_or_manual_budget_review',
          role,
          endpointProfile,
          modelId: endpoint.modelId,
          observedCostUsdPer1kTokens: endpoint.estimatedCostUsdPer1kTokens,
          ceilingUsdPer1kTokens: maxCost,
          reason: 'cost_ceiling_exceeded',
        }));
      }

      const observedLatency = finiteNumber(health.p95LatencyMs ?? endpoint.targetLatencyMs);
      if (maxLatency !== null && observedLatency !== null && observedLatency > maxLatency) {
        blockedReasons.push('latency_ceiling_exceeded');
        actions.push(action({
          type: 'model_endpoint.latency_ceiling_exceeded',
          action: 'recommend_lower_latency_endpoint',
          role,
          endpointProfile,
          modelId: endpoint.modelId,
          observedP95LatencyMs: observedLatency,
          ceilingP95LatencyMs: maxLatency,
          reason: 'latency_ceiling_exceeded',
        }));
      }

      if (routeRequiresVision({ role, policy }) && !endpointSupportsVision(endpoint)) {
        blockedReasons.push('vision_capability_mismatch');
        actions.push(action({
          type: 'model_endpoint.vision_capability_mismatch',
          action: 'recommend_vision_capable_endpoint',
          role,
          endpointProfile,
          modelId: endpoint.modelId,
          reason: 'vision_capability_mismatch',
        }));
      }
    }

    routeRecommendations[role] = blockedRoute({ endpointProfile, blockedReasons });
  }

  const availableModelProfiles = new Set(Object.values(normalizedEndpoints).map((endpoint) => endpoint.modelId));
  for (const modelProfile of requiredModelProfiles) {
    if (!availableModelProfiles.has(modelProfile)) {
      actions.push(action({
        type: 'model_endpoint.missing_model_profile',
        action: 'recommend_model_profile_capacity_review',
        modelProfile,
        reason: 'missing_model_profile',
      }));
    }
  }

  const uniqueActions = dedupeActions(actions);
  const blockedRouteCount = Object.values(routeRecommendations)
    .filter((recommendation) => recommendation.allowed === false).length;

  return {
    authority: AUTHORITY,
    canPromote: false,
    recommendationOnly: true,
    autoProcurementAllowed: false,
    routerDefaultsChanged: false,
    endpoints: normalizedEndpoints,
    routeRecommendations,
    actions: uniqueActions,
    summary: {
      endpointCount: Object.keys(normalizedEndpoints).length,
      routeCount: Object.keys(routeRecommendations).length,
      actionCount: uniqueActions.length,
      blockedRouteCount,
      degradedEndpointCount: uniqueActions
        .filter((item) => item.type === 'endpoint.degraded').length,
      missingSpecialistCount: uniqueActions
        .filter((item) => item.type.startsWith('model_endpoint.missing_')).length,
    },
  };
}
