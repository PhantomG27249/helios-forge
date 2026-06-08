import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const result = { exitCode, stdout, stderr };
      if (exitCode === 0) {
        resolve(result);
      } else {
        reject(new Error(stderr || stdout || `git ${args.join(' ')} failed with ${exitCode}`));
      }
    });
  });
}

async function currentBranch(cwd) {
  try {
    const result = await runGit(['branch', '--show-current'], cwd);
    return result.stdout.trim() || 'HEAD';
  } catch {
    return 'unknown';
  }
}

function assertSafeTargets({ workspaceRoot, targetPaths = [] }) {
  for (const targetPath of targetPaths) {
    if (!isUnderRoot(workspaceRoot, targetPath)) {
      throw new Error(`target path outside workspace: ${targetPath}`);
    }
  }
}

export function createGitApplyAdapter({ workspaceRoot } = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

  return async function gitApplyAdapter({ patch, cwd = resolvedWorkspaceRoot, targetPaths = [] } = {}) {
    if (!patch) {
      throw new Error('patch is required');
    }
    const resolvedCwd = path.resolve(cwd);
    if (!isUnderRoot(resolvedWorkspaceRoot, resolvedCwd)) {
      throw new Error(`cwd outside workspace: ${cwd}`);
    }
    assertSafeTargets({ workspaceRoot: resolvedWorkspaceRoot, targetPaths });

    const tempDir = await mkdtemp(path.join(tmpdir(), 'helios-git-apply-'));
    const patchPath = path.join(tempDir, 'change.patch');
    try {
      await writeFile(patchPath, patch, 'utf8');
      await runGit(['apply', '--check', patchPath], resolvedCwd);
      const applyResult = await runGit(['apply', patchPath], resolvedCwd);
      return {
        applied: true,
        checked: true,
        branch: await currentBranch(resolvedCwd),
        cwd: resolvedCwd,
        targetPaths,
        stdout: applyResult.stdout,
        stderr: applyResult.stderr,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
