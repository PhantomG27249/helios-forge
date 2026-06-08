import path from 'node:path';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function truncateText(text, maxLength) {
  const value = String(text || '');
  if (!Number.isFinite(maxLength) || maxLength < 0 || value.length <= maxLength) {
    return { metadataText: value, truncated: false };
  }
  return { metadataText: value.slice(0, maxLength), truncated: true };
}

export async function runOcrWorker({
  taskId,
  workspaceRoot,
  imagePath,
  ocrRuntime,
  maxMetadataTextLength = 2048,
} = {}) {
  if (!ocrRuntime || typeof ocrRuntime.recognize !== 'function') {
    return { status: 'unavailable', reason: 'ocr_runtime_required' };
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const resolvedImagePath = path.resolve(imagePath || '');
  const taskDir = path.join(workspaceRoot, '.harness', 'visual', taskId);
  if (!isUnderRoot(taskDir, resolvedImagePath)) {
    throw new Error('imagePath must stay inside .harness/visual task directory');
  }

  const recognized = await ocrRuntime.recognize({ imagePath: resolvedImagePath, taskId });
  const text = String(recognized?.text || '');
  const { metadataText, truncated } = truncateText(text, maxMetadataTextLength);

  return {
    status: 'completed',
    text,
    metadataText,
    truncated,
    confidence: recognized?.confidence,
  };
}
