export function createProvenance({ taskId, path, reason, sourceType = 'workspace' }) {
  return {
    taskId,
    path,
    reason,
    sourceType,
    observedAt: new Date().toISOString(),
  };
}
