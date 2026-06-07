import { createStableArtifactId, createVisualEstimate } from './artifactManifest.js';

export function createFigureCropArtifact({
  taskId,
  sourceArtifactId,
  sourcePath,
  targetPath,
  bounds,
  sourceDimensions,
  label,
} = {}) {
  const payload = { taskId, sourceArtifactId, sourcePath, targetPath, bounds, sourceDimensions, label };

  return {
    artifactId: createStableArtifactId('figure_crop', payload),
    taskId,
    type: 'figure_crop',
    summary: label ? `Figure crop artifact for ${label}` : `Figure crop artifact for ${targetPath}`,
    artifacts: {
      source: sourcePath,
      crop: targetPath,
    },
    metadata: {
      sourceArtifactId,
      sourceDimensions,
      bounds,
      targetPath,
      label,
    },
    visualContext: createVisualEstimate({ width: bounds?.width, height: bounds?.height }),
  };
}
