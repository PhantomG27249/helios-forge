export function createVisualDiffArtifact({ taskId, beforePath, afterPath, diffPath, summary }) {
  return {
    artifactId: `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    type: 'visual_diff',
    summary,
    artifacts: {
      before: beforePath,
      after: afterPath,
      diff: diffPath,
    },
  };
}
