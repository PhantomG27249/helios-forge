import path from 'path';

function makePatchId() {
  return `patch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isSafeRelativePath(filePath) {
  if (!filePath || path.isAbsolute(filePath)) return false;
  const normalized = filePath.replace(/\\/g, '/');
  return !normalized.startsWith('../') && !normalized.includes('/../');
}

export function createPatchProposal({
  taskId,
  intent,
  files = [],
  validationPlan = [],
  createdBy = 'sidecar-orchestrator',
}) {
  return {
    patchId: makePatchId(),
    taskId,
    intent,
    files: files.map((file) => ({ ...file })),
    validationPlan: [...validationPlan],
    createdBy,
    createdAt: new Date().toISOString(),
    requiresApproval: true,
  };
}

export function validatePatchProposal(proposal) {
  const reasons = [];
  if (!proposal.taskId) reasons.push('missing_task_id');
  if (!proposal.intent) reasons.push('missing_intent');
  if (!Array.isArray(proposal.files)) reasons.push('missing_files');

  for (const file of proposal.files || []) {
    if (!isSafeRelativePath(file.path)) {
      reasons.push('unsafe_file_path');
      break;
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}
