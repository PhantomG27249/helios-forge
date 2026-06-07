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

export function buildMultimodalRequest({ profileName, prompt, visualItems = [] }) {
  const profile = getModelProfile(profileName);
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
