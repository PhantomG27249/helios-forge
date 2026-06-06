export function createRecoveryEvent({
  taskId,
  category,
  recoverability,
  summary,
  detail = {},
}) {
  return {
    type: 'recovery.event',
    taskId,
    category,
    recoverability,
    summary,
    detail,
  };
}
