export function createVisualContextItem(artifact) {
  return {
    type: 'visual_artifact',
    artifactId: artifact.artifactId,
    reason: artifact.summary || 'Visual artifact relevant to task',
    tokensEstimated: 1200,
    artifact,
  };
}
