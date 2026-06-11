const STRING_LIMITS = {
  profileId: 96,
  baseUrl: 512,
  modelId: 256,
  apiKeyEnv: 128,
};

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, limit) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function normalizeEndpointProfile(profile, profileId, { preserveApiKeyConfigured = false } = {}) {
  if (!isPlainObject(profile)) return null;

  const baseUrl = boundedString(profile.baseUrl, STRING_LIMITS.baseUrl);
  const modelId = boundedString(profile.modelId ?? profile.model, STRING_LIMITS.modelId);
  if (!baseUrl || !modelId) return null;

  const normalized = {
    baseUrl,
    modelId,
  };
  const safeProfileId = boundedString(profileId, STRING_LIMITS.profileId);
  if (safeProfileId) {
    normalized.endpointProfile = safeProfileId;
  }

  if (typeof profile.supportsVision === 'boolean') {
    normalized.supportsVision = profile.supportsVision;
  }
  if (typeof profile.healthEnabled === 'boolean') {
    normalized.healthEnabled = profile.healthEnabled;
  }

  const apiKeyEnv = boundedString(profile.apiKeyEnv, STRING_LIMITS.apiKeyEnv);
  if (apiKeyEnv) {
    normalized.apiKeyEnv = apiKeyEnv;
  }
  if (boundedString(profile.apiKey ?? profile.api_key, 1) || (preserveApiKeyConfigured && profile.apiKeyConfigured === true)) {
    normalized.apiKeyConfigured = true;
  }

  return normalized;
}

export function normalizeEndpointProfiles(endpointProfiles = {}) {
  if (!isPlainObject(endpointProfiles)) return {};

  const normalized = {};
  for (const [profileId, profile] of Object.entries(endpointProfiles)) {
    const safeProfileId = boundedString(profileId, STRING_LIMITS.profileId);
    const endpoint = normalizeEndpointProfile(
      profile,
      safeProfileId,
      { preserveApiKeyConfigured: profile?.endpointProfile === safeProfileId },
    );
    if (safeProfileId && endpoint) {
      normalized[safeProfileId] = endpoint;
    }
  }
  return normalized;
}

export function resolveEndpointProfile({ endpointProfiles, endpointProfileId, fallback = {} } = {}) {
  const normalized = normalizeEndpointProfiles(endpointProfiles);
  const safeProfileId = boundedString(endpointProfileId, STRING_LIMITS.profileId);
  if (safeProfileId && normalized[safeProfileId]) {
    return { ...normalized[safeProfileId] };
  }

  return normalizeEndpointProfile(
    {
      ...fallback,
      baseUrl: fallback.baseUrl ?? fallback.swarmBaseUrl,
      modelId: fallback.modelId ?? fallback.swarmModelId ?? fallback.model,
    },
    '',
  );
}

export function endpointProfileToOverride(endpoint = {}) {
  const normalized = normalizeEndpointProfile(
    endpoint,
    endpoint.endpointProfile || '',
    { preserveApiKeyConfigured: true },
  );
  if (!normalized) return {};

  const override = {
    model: normalized.modelId,
    baseUrl: normalized.baseUrl,
  };

  if (typeof normalized.supportsVision === 'boolean') {
    override.supportsVision = normalized.supportsVision;
  }
  if (normalized.endpointProfile) {
    override.modelCouncilEndpointProfile = normalized.endpointProfile;
  }
  if (normalized.apiKeyEnv) {
    override.apiKeyEnv = normalized.apiKeyEnv;
  }
  if (normalized.apiKeyConfigured === true) {
    override.apiKeyConfigured = true;
  }
  if (typeof normalized.healthEnabled === 'boolean') {
    override.healthEnabled = normalized.healthEnabled;
  }

  return override;
}
