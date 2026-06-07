export function createApprovalRequest({
  taskId,
  risk,
  reason,
  proposedAction,
  choices = ['approve', 'reject', 'edit', 'defer'],
}) {
  return {
    type: 'approval.required',
    actionId: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    risk,
    reason,
    choices,
    proposedAction,
  };
}
