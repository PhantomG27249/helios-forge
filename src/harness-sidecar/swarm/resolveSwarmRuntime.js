import { getModelProfile } from '../model/modelProfiles.js';

export const SWARM_ENDPOINT_UNCONFIGURED_ADVISORY = {
  reason: 'swarm_endpoint_unconfigured',
  setupHint: 'Set models.swarmBaseUrl in .harness/config.yaml or HELIOS_SWARM_MODEL_BASE_URL',
};

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export function resolveSwarmBaseUrl({ harnessConfig, profile } = {}) {
  const fromHarness = normalizeOptionalString(harnessConfig?.models?.swarmBaseUrl);
  if (fromHarness) return fromHarness;

  return normalizeOptionalString(profile?.baseUrl);
}

export function resolveSwarmRuntime({
  harnessConfig,
  profile,
  profileName,
  getModelProfile: getModelProfileFn = getModelProfile,
} = {}) {
  let resolvedProfile = profile ?? null;

  if (!resolvedProfile && profileName) {
    try {
      resolvedProfile = getModelProfileFn(profileName);
    } catch {
      resolvedProfile = null;
    }
  }

  const baseUrl = resolveSwarmBaseUrl({ harnessConfig, profile: resolvedProfile });
  if (!baseUrl) {
    return {
      gateway: null,
      advisory: { ...SWARM_ENDPOINT_UNCONFIGURED_ADVISORY },
    };
  }

  const modelId = normalizeOptionalString(harnessConfig?.models?.swarmModelId)
    || normalizeOptionalString(resolvedProfile?.model)
    || null;

  return {
    gateway: {
      baseUrl,
      modelId,
      profileName: profileName || resolvedProfile?.name || null,
      profile: resolvedProfile,
    },
    advisory: null,
  };
}
