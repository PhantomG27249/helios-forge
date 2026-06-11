import { getModelProfile } from './modelProfiles.js';

function estimateTextTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function collectVisualPaths(item) {
  const artifact = item.artifact || item;
  if (artifact.path) return [artifact.path];
  if (artifact.artifacts && typeof artifact.artifacts === 'object') {
    return Object.values(artifact.artifacts).filter(Boolean);
  }
  return [];
}

function resolveProfile(profileName, profileOverride = {}) {
  let baseProfile = {};
  try {
    baseProfile = getModelProfile(profileName);
  } catch (error) {
    if (!profileOverride || Object.keys(profileOverride).length === 0) throw error;
    baseProfile = { name: profileName, supportsVision: false, supportsTools: true };
  }
  return {
    ...baseProfile,
    ...profileOverride,
    name: profileOverride.name || baseProfile.name || profileName,
  };
}

export function buildMultimodalRequest({
  profileName,
  profileOverride = {},
  prompt,
  visualItems = [],
}) {
  const profile = resolveProfile(profileName, profileOverride);
  if (visualItems.length > 0 && !profile.supportsVision) {
    throw new Error(`Model profile does not support vision inputs: ${profileName}`);
  }

  const visionInputs = visualItems.flatMap((item) =>
    collectVisualPaths(item).map((path) => ({
      artifactId: item.artifactId || null,
      path,
      kind: item.type || item.artifact?.type || 'image_reference',
    })),
  );

  const content = [
    {
      type: 'text',
      text: prompt,
    },
    ...visionInputs.map((input) => ({
      type: 'image_reference',
      artifactId: input.artifactId,
      path: input.path,
      kind: input.kind,
    })),
  ];

  return {
    profile,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    visionInputs,
    tokensEstimated: estimateTextTokens(prompt) + visionInputs.length * 1200,
  };
}
