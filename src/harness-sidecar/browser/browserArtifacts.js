import path from 'node:path';

const RAW_PAYLOAD_METADATA_KEYS = new Set([
  'body',
  'bytes',
  'buffer',
  'content',
  'data',
  'dataUrl',
  'raw',
  'requestBody',
  'responseBody',
]);

function assertTaskId(taskId) {
  if (!taskId || typeof taskId !== 'string' || taskId.includes('/') || taskId.includes('\\') || taskId.includes('..')) {
    throw new Error('Browser task id must be a safe path segment');
  }
}

function isInsideDirectory(candidatePath, directoryPath) {
  const relative = path.relative(directoryPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relativeWorkspacePath({ workspaceRoot, artifactPath }) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(artifactPath));
  return relative || '.';
}

function sanitizeArtifactMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !RAW_PAYLOAD_METADATA_KEYS.has(key)),
  );
}

export function browserTaskDir({ workspaceRoot, taskId }) {
  assertTaskId(taskId);
  return path.join(workspaceRoot, '.harness', 'browser', taskId);
}

export function resolveBrowserArtifactPath({
  workspaceRoot,
  taskId,
  targetPath,
  defaultName,
  label = 'browser artifact',
} = {}) {
  const taskDir = path.resolve(browserTaskDir({ workspaceRoot, taskId }));
  const requestedPath = targetPath || defaultName;
  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new Error(`${label} path is required`);
  }

  const artifactPath = path.resolve(path.isAbsolute(requestedPath)
    ? requestedPath
    : path.join(taskDir, requestedPath));

  if (!isInsideDirectory(artifactPath, taskDir)) {
    throw new Error('Browser artifact path must stay inside task directory');
  }

  return artifactPath;
}

export function summarizeBrowserArtifact({ workspaceRoot, taskId, type, path: artifactPath, metadata } = {}) {
  assertTaskId(taskId);
  const taskDir = path.resolve(browserTaskDir({ workspaceRoot, taskId }));
  const resolvedPath = path.resolve(artifactPath);

  if (!isInsideDirectory(resolvedPath, taskDir)) {
    throw new Error('Browser artifact path must stay inside task directory');
  }

  return {
    taskId,
    type,
    path: relativeWorkspacePath({ workspaceRoot, artifactPath: resolvedPath }),
    metadata: sanitizeArtifactMetadata(metadata),
  };
}
