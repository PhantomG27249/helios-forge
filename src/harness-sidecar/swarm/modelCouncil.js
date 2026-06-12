import {
  endpointProfileToOverride,
  normalizeEndpointProfiles,
  resolveEndpointProfile,
} from '../model/modelEndpointProfiles.js';
import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
export {
  buildModelDebateEvidence,
  buildModelDebatePrompt,
} from './modelDebateEvidence.js';

const DEFAULT_DIVERSITY_REQUIRED = 2;
const DEFAULT_DISAGREEMENT_THRESHOLD = 0.35;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, maxLength = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function safeVisibleText(value, maxLength = 160) {
  return quarantineModelVisiblePayload(boundedText(value, maxLength), { maxStringLength: maxLength }).value;
}

function safeMapKey(value, fallback) {
  const safe = safeVisibleText(value, 96);
  return safe || fallback;
}

function numericSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeEndpointMetadata(endpoint = {}) {
  if (!endpoint?.baseUrl || !endpoint?.modelId) return null;
  const metadata = {
    endpointProfile: safeVisibleText(endpoint.endpointProfile, 96) || undefined,
    modelId: safeVisibleText(endpoint.modelId, 256),
  };
  if (typeof endpoint.supportsVision === 'boolean') metadata.supportsVision = endpoint.supportsVision;
  if (typeof endpoint.healthEnabled === 'boolean') metadata.healthEnabled = endpoint.healthEnabled;
  if (typeof endpoint.healthy === 'boolean') metadata.healthy = endpoint.healthy;
  if (Number.isFinite(Number(endpoint.recommendedConcurrency))) {
    metadata.recommendedConcurrency = Math.max(1, Math.floor(Number(endpoint.recommendedConcurrency)));
  }
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== ''));
}

function disabledCouncil() {
  return {
    enabled: false,
    roleRoutes: {},
    endpointProfiles: {},
    profileOverrides: {},
    bridgeHints: null,
    authority: 'disabled',
    canPromote: false,
  };
}

function buildRoleRoute({ role, routeConfig = {}, endpointProfiles, fallbackModel }) {
  const rawModelProfile = boundedText(routeConfig.modelProfile || fallbackModel.profileName, 96);
  const rawEndpointProfile = boundedText(routeConfig.endpointProfile, 96);
  const modelProfile = safeVisibleText(routeConfig.modelProfile || fallbackModel.profileName, 96);
  if (!modelProfile) return null;
  const endpointProfile = safeVisibleText(routeConfig.endpointProfile, 96);
  const endpoint = resolveEndpointProfile({
    endpointProfiles,
    endpointProfileId: rawEndpointProfile,
    fallback: fallbackModel,
  });
  const route = {
    role,
    modelProfile,
    authority: 'evidence_only',
    canPromote: false,
  };
  if (endpointProfile) route.endpointProfile = endpointProfile;
  const endpointMetadata = safeEndpointMetadata(endpoint);
  if (endpointMetadata) route.endpoint = endpointMetadata;
  route.privateEndpointOverride = endpointProfileToOverride({
    ...endpoint,
    endpointProfile: rawEndpointProfile,
  });
  Object.defineProperty(route, 'privateEndpointOverride', {
    value: route.privateEndpointOverride,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(route, 'rawModelProfile', {
    value: rawModelProfile,
    enumerable: false,
    configurable: true,
  });
  return route;
}

function bridgeHintsForCouncil(council) {
  if (!council.enabled) return null;
  return {
    enabled: true,
    authority: 'evidence_only',
    canPromote: false,
    mode: council.mode,
    diversityRequired: council.diversityRequired,
    roleRoutes: Object.fromEntries(
      Object.entries(council.roleRoutes).map(([role, route]) => [
        role,
        {
          modelProfile: route.modelProfile,
          endpointProfile: route.endpointProfile,
          authority: 'evidence_only',
          canPromote: false,
        },
      ]),
    ),
  };
}

export function buildModelCouncilRuntime({ harnessConfig = {}, fallbackModel = {} } = {}) {
  if (
    harnessConfig?.features?.multiModelSwarm !== true
    || harnessConfig?.modelCouncil?.enabled !== true
  ) {
    return disabledCouncil();
  }

  const modelCouncil = isPlainObject(harnessConfig.modelCouncil) ? harnessConfig.modelCouncil : {};
  const endpointProfiles = normalizeEndpointProfiles(modelCouncil.endpointProfiles);
  const roleConfigs = isPlainObject(modelCouncil.roles) ? modelCouncil.roles : {};
  const roleRoutes = {};
  for (const [rawRole, routeConfig] of Object.entries(roleConfigs)) {
    if (!isPlainObject(routeConfig)) continue;
    const role = safeMapKey(rawRole, `role_${Object.keys(roleRoutes).length + 1}`);
    if (!role) continue;
    const route = buildRoleRoute({
      role,
      routeConfig,
      endpointProfiles,
      fallbackModel,
    });
    if (route) roleRoutes[role] = route;
  }

  const profileOverrides = {};
  for (const route of Object.values(roleRoutes)) {
    if (!route.modelProfile || !route.privateEndpointOverride) continue;
    profileOverrides[route.modelProfile] = route.privateEndpointOverride;
  }

  const council = {
    enabled: true,
    mode: boundedText(modelCouncil.mode || 'advisory', 48) || 'advisory',
    diversityRequired: Math.max(1, Math.floor(numericSetting(
      modelCouncil.diversityRequired,
      DEFAULT_DIVERSITY_REQUIRED,
    ))),
    disagreementThreshold: Math.max(0, numericSetting(
      modelCouncil.disagreementThreshold,
      DEFAULT_DISAGREEMENT_THRESHOLD,
    )),
    roleRoutes,
    endpointProfiles: Object.fromEntries(Object.entries(endpointProfiles).map(([profileId, endpoint], index) => [
      safeMapKey(profileId, `endpoint_${index + 1}`),
      safeEndpointMetadata(endpoint) || { endpointProfile: safeMapKey(profileId, `endpoint_${index + 1}`) },
    ])),
    authority: 'evidence_only',
    canPromote: false,
  };
  Object.defineProperty(council, 'profileOverrides', {
    value: profileOverrides,
    enumerable: false,
    configurable: true,
  });
  council.bridgeHints = bridgeHintsForCouncil(council);
  return council;
}

function fallbackRoute({ council = {}, attempt = {}, role } = {}) {
  const modelProfile = safeVisibleText(
    attempt.profile?.modelProfile || council.fallbackProfileName || '',
    96,
  );
  if (!modelProfile) return null;
  return {
    role: safeVisibleText(role || attempt.profile?.role || 'implementer', 96) || 'implementer',
    modelProfile,
    authority: 'evidence_only',
    canPromote: false,
  };
}

export function resolveAttemptModelRoute({ council, attempt = {}, role } = {}) {
  const requestedRole = boundedText(role, 96);
  if (!council?.enabled) {
    return fallbackRoute({ council, attempt, role: requestedRole });
  }

  const lookupKeys = [
    attempt.profile?.id,
    attempt.profile?.role,
    requestedRole,
  ].map((key) => boundedText(key, 96)).filter(Boolean);

  for (const key of lookupKeys) {
    const route = council.roleRoutes?.[key];
    if (route) return { ...route, endpoint: route.endpoint ? { ...route.endpoint } : undefined };
  }

  const attemptFallback = fallbackRoute({ council, attempt, role: requestedRole });
  if (attemptFallback) return attemptFallback;

  const defaultRoute = council.roleRoutes?.implementer;
  if (defaultRoute) {
    return { ...defaultRoute, endpoint: defaultRoute.endpoint ? { ...defaultRoute.endpoint } : undefined };
  }

  return null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function uniqueSafe(values = [], limit = 160) {
  return unique(values.map((value) => safeVisibleText(value, limit)).filter(Boolean));
}

function scoreRange(attempts = []) {
  const scores = attempts
    .map((attempt) => Number(attempt.score))
    .filter((score) => Number.isFinite(score));
  if (scores.length < 2) return 0;
  return Math.max(...scores) - Math.min(...scores);
}

function disagreementSummary({ attempts, council }) {
  const reasons = [];
  const verifierStates = unique(attempts.map((attempt) => (
    attempt.verifierPassed === true ? 'passed' : 'not_passed'
  )));
  if (verifierStates.length > 1) reasons.push('verifier_outcome_divergence');
  const summaries = unique(attempts.map((attempt) => boundedText(attempt.output?.summary, 240)));
  if (summaries.length > 1) reasons.push('distinct_attempt_summaries');
  const range = scoreRange(attempts);
  if (range >= (Number(council?.disagreementThreshold) || DEFAULT_DISAGREEMENT_THRESHOLD) * 100) {
    reasons.push('score_spread');
  }
  return {
    status: reasons.length > 0 ? 'present' : 'not_detected',
    reasons,
  };
}

export function summarizeModelCouncil({ council, attempts = [], champion = null } = {}) {
  if (!council?.enabled) {
    return {
      enabled: false,
      authority: 'disabled',
      canPromote: false,
    };
  }
  const modelProfiles = uniqueSafe(attempts.map((attempt) => (
    attempt.model?.route?.modelProfile || attempt.model?.profileName
  )), 256);
  const endpointProfiles = uniqueSafe(attempts.map((attempt) => attempt.model?.route?.endpointProfile), 96);
  const roles = uniqueSafe(attempts.map((attempt) => attempt.role || attempt.profile?.id || attempt.profile?.role), 96);
  const supportingAttemptIds = attempts
    .filter((attempt) => attempt.verifierPassed === true)
    .map((attempt) => safeVisibleText(attempt.attemptId, 128))
    .filter(Boolean);
  const championRoute = champion?.model?.route || null;

  return {
    enabled: true,
    authority: 'evidence_only',
    canPromote: false,
    modelDiversity: {
      uniqueModelProfiles: modelProfiles.length,
      modelProfiles,
      uniqueEndpointProfiles: endpointProfiles.length,
      endpointProfiles,
      diversityRequired: council.diversityRequired || DEFAULT_DIVERSITY_REQUIRED,
      satisfied: modelProfiles.length >= (council.diversityRequired || DEFAULT_DIVERSITY_REQUIRED),
    },
    coverage: {
      roles,
      roleCount: roles.length,
    },
    agreement: {
      supportingAttemptIds,
    },
    disagreement: disagreementSummary({ attempts, council }),
    championSupport: champion
      ? {
        attemptId: safeVisibleText(champion.attemptId, 128) || null,
        modelProfile: safeVisibleText(championRoute?.modelProfile || champion.model?.profileName || '', 256) || null,
        endpointProfile: safeVisibleText(championRoute?.endpointProfile || '', 96) || null,
        verifierPassed: champion.verifierPassed === true,
      }
      : null,
  };
}
