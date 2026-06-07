import { createStableArtifactId, createVisualEstimate } from './artifactManifest.js';

export function createScreenshotArtifact({ taskId, imagePath, viewport, source = {}, summary } = {}) {
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  const payload = { taskId, imagePath, viewport, source };

  return {
    artifactId: createStableArtifactId('screenshot', payload),
    taskId,
    type: 'screenshot',
    summary: summary || `Screenshot artifact for ${imagePath}`,
    artifacts: {
      image: imagePath,
    },
    metadata: {
      viewport,
      source,
    },
    visualContext: createVisualEstimate({ width, height }),
  };
}
