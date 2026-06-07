export function compileFinalAuditReport({ task, state, audit, approval }) {
  const lines = [
    '# Final Audit',
    '',
    `Task: ${task.task}`,
    `Task ID: ${task.taskId}`,
    `Status: ${task.status}`,
    `Approval Choice: ${approval.choice}`,
    '',
    '## State',
    '',
    `Version: ${state.version}`,
    `Patch ID: ${state.value.patchId || 'none'}`,
    '',
    '## Audit Trail',
    '',
  ];

  for (const entry of audit) {
    lines.push(`- ${entry.timestamp} ${entry.actor} ${entry.operation} ${entry.target}: ${entry.reason}`);
  }

  return `${lines.join('\n')}\n`;
}
