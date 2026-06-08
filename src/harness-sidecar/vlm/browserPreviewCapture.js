import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function visualTaskDir({ workspaceRoot, taskId }) {
  return path.join(workspaceRoot, '.harness', 'visual', taskId);
}

function resolveArtifactPath({ workspaceRoot, taskId, targetPath, defaultName, label }) {
  const taskDir = visualTaskDir({ workspaceRoot, taskId });
  const resolved = targetPath
    ? path.resolve(taskDir, targetPath)
    : path.join(taskDir, defaultName);

  if (!isUnderRoot(workspaceRoot, resolved)) {
    throw new Error(`${label} must stay inside workspace`);
  }
  if (!isUnderRoot(taskDir, resolved)) {
    throw new Error(`${label} must stay inside workspace visual task directory`);
  }
  return resolved;
}

export async function captureBrowserPreview({
  taskId,
  workspaceRoot,
  url,
  outputPath,
  browserRuntime,
} = {}) {
  if (!browserRuntime || typeof browserRuntime.capture !== 'function') {
    return { status: 'unavailable', reason: 'browser_runtime_required' };
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const resolvedOutputPath = resolveArtifactPath({
    workspaceRoot,
    taskId,
    targetPath: outputPath,
    defaultName: 'web-preview.png',
    label: 'outputPath',
  });
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const captured = await browserRuntime.capture({ url, outputPath: resolvedOutputPath, taskId });
  const imagePath = captured?.imagePath || resolvedOutputPath;
  if (!isUnderRoot(visualTaskDir({ workspaceRoot, taskId }), imagePath)) {
    throw new Error('imagePath must stay inside .harness/visual task directory');
  }

  return {
    status: 'captured',
    imagePath: path.resolve(imagePath),
    width: captured?.width || captured?.viewport?.width || 0,
    height: captured?.height || captured?.viewport?.height || 0,
    viewport: captured?.viewport,
  };
}
