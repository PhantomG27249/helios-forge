import path from 'node:path';

function normalizeWorkspaceRoot(value) {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

export function selectHarnessWorkspaceRoot({
  requestedWorkspaceRoot = '',
  currentHarnessRoot = '',
  piCwd = '',
} = {}) {
  return normalizeWorkspaceRoot(requestedWorkspaceRoot)
    || normalizeWorkspaceRoot(currentHarnessRoot)
    || normalizeWorkspaceRoot(piCwd)
    || process.cwd();
}

export function shouldRecreateHarnessForWorkspace({
  currentWorkspaceRoot = '',
  desiredWorkspaceRoot = '',
} = {}) {
  const current = normalizeWorkspaceRoot(currentWorkspaceRoot);
  const desired = normalizeWorkspaceRoot(desiredWorkspaceRoot);
  return Boolean(desired && current !== desired);
}
