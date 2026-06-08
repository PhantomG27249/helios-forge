import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

export async function captureVisualDiff({
  taskId,
  workspaceRoot,
  beforePath,
  afterPath,
  outputPath,
  diffRuntime,
} = {}) {
  if (!diffRuntime || typeof diffRuntime.compare !== 'function') {
    return { status: 'unavailable', reason: 'visual_diff_runtime_required' };
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const taskDir = path.join(workspaceRoot, '.harness', 'visual', taskId);
  const resolvedOutputPath = outputPath
    ? path.resolve(taskDir, outputPath)
    : path.join(taskDir, 'visual-diff.png');
  if (!isUnderRoot(taskDir, resolvedOutputPath)) {
    throw new Error('outputPath must stay inside .harness/visual task directory');
  }
  if (beforePath && !isUnderRoot(workspaceRoot, beforePath)) {
    throw new Error('beforePath must stay inside workspace');
  }
  if (afterPath && !isUnderRoot(workspaceRoot, afterPath)) {
    throw new Error('afterPath must stay inside workspace');
  }

  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const diff = await diffRuntime.compare({
    beforePath: beforePath ? path.resolve(beforePath) : beforePath,
    afterPath: afterPath ? path.resolve(afterPath) : afterPath,
    outputPath: resolvedOutputPath,
    taskId,
  });
  const diffPath = diff?.diffPath || resolvedOutputPath;
  if (!isUnderRoot(taskDir, diffPath)) {
    throw new Error('diffPath must stay inside .harness/visual task directory');
  }

  return {
    status: 'captured',
    diffPath: path.resolve(diffPath),
    summary: diff?.summary || 'Production visual diff captured.',
    changedPixels: diff?.changedPixels,
  };
}
