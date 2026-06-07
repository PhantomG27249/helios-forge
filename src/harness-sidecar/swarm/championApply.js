import path from 'path';

function patchForChampion(champion = {}) {
  return champion.output?.patch || champion.patch || '';
}

function evidenceForChampion(champion = {}) {
  return champion.verifierEvidence || champion.output?.verifierEvidence || [];
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function stripDiffPrefix(filePath = '') {
  if (filePath === '/dev/null') return '';
  return filePath.replace(/^[ab]\//, '');
}

function extractPatchPaths(patchText = '') {
  const paths = [];

  for (const line of patchText.split('\n')) {
    const diffMatch = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
    if (diffMatch) {
      paths.push(diffMatch[2]);
      continue;
    }

    const fileMatch = line.match(/^(?:---|\+\+\+)\s+(.+)$/);
    if (fileMatch) {
      paths.push(stripDiffPrefix(fileMatch[1].trim()));
    }
  }

  return unique(paths.map(stripDiffPrefix));
}

function isSafeRelativePath(filePath = '') {
  const segments = filePath.split(/[\\/]+/);
  return Boolean(filePath)
    && !path.isAbsolute(filePath)
    && !/^[a-zA-Z]:/.test(filePath)
    && !segments.includes('..');
}

function isUnderRoot(workspaceRoot, absolutePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveTargetPaths({ workspaceRoot, patch }) {
  const unsafePaths = [];
  const targetPaths = [];

  for (const filePath of extractPatchPaths(patch)) {
    if (!isSafeRelativePath(filePath)) {
      unsafePaths.push(filePath);
      continue;
    }

    const absolutePath = path.resolve(workspaceRoot, filePath);
    if (!isUnderRoot(workspaceRoot, absolutePath)) {
      unsafePaths.push(filePath);
      continue;
    }

    targetPaths.push(absolutePath);
  }

  return {
    targetPaths: unique(targetPaths),
    unsafePaths: unique(unsafePaths),
  };
}

export function proposeChampionApply({
  workspaceRoot,
  champion = {},
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const patch = patchForChampion(champion);
  const { targetPaths, unsafePaths } = resolveTargetPaths({ workspaceRoot, patch });
  const reasons = [];

  if (!patch) reasons.push('missing_patch');
  if (unsafePaths.length) reasons.push('unsafe_target_path');

  return {
    attemptId: champion.attemptId,
    approvalRequired: true,
    safe: reasons.length === 0,
    reasons,
    workspaceRoot: path.resolve(workspaceRoot),
    targetPaths,
    unsafePaths,
    patchStats: champion.patchStats || champion.output?.patchStats,
    verifierEvidence: evidenceForChampion(champion),
  };
}

export async function applyChampion({
  workspaceRoot,
  champion = {},
  approved = false,
  approvedBy = null,
  applyAdapter,
} = {}) {
  const plan = proposeChampionApply({ workspaceRoot, champion });

  if (!approved) {
    throw new Error('Champion apply approval required');
  }
  if (!plan.safe) {
    throw new Error(`Champion apply has unsafe target path: ${plan.unsafePaths.join(', ')}`);
  }
  if (typeof applyAdapter !== 'function') {
    throw new Error('applyAdapter is required');
  }

  const patch = patchForChampion(champion);
  const adapterResult = await applyAdapter({
    patch,
    cwd: plan.workspaceRoot,
    targetPaths: plan.targetPaths,
    champion,
  });

  return {
    attemptId: champion.attemptId,
    applied: adapterResult?.applied !== false,
    approvedBy,
    approvedAt: new Date().toISOString(),
    workspaceRoot: plan.workspaceRoot,
    targetPaths: plan.targetPaths,
    verifierEvidence: plan.verifierEvidence,
    patchStats: plan.patchStats,
    adapterResult,
  };
}
