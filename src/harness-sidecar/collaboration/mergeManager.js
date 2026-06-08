import { spawn } from 'node:child_process';
import path from 'node:path';

import { createGitApplyAdapter } from '../tools/gitApplyAdapter.js';

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

async function currentHead(cwd) {
  const result = await runGit(['rev-parse', 'HEAD'], cwd);
  return result.stdout.trim();
}

function patchForChampion(champion = {}) {
  return champion.output?.patch || champion.patch || '';
}

function verifierCommandsFor({ champion = {}, verifierCommands = [] }) {
  const commands = verifierCommands.length
    ? verifierCommands
    : champion.verifierCommands || champion.output?.verifierCommands || [];
  return Array.isArray(commands) ? commands.filter(Boolean) : [commands].filter(Boolean);
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function stripDiffPrefix(filePath = '') {
  if (filePath === '/dev/null') return '';
  return filePath.replace(/^[ab]\//u, '');
}

function extractPatchPaths(patchText = '') {
  const paths = [];

  for (const line of patchText.split('\n')) {
    const diffMatch = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/u);
    if (diffMatch) {
      paths.push(diffMatch[2]);
      continue;
    }

    const fileMatch = line.match(/^(?:---|\+\+\+)\s+(.+)$/u);
    if (fileMatch) {
      paths.push(stripDiffPrefix(fileMatch[1].trim()));
    }
  }

  return unique(paths.map(stripDiffPrefix));
}

function isSafeRelativePath(filePath = '') {
  const segments = filePath.split(/[\\/]+/u);
  return Boolean(filePath)
    && !path.isAbsolute(filePath)
    && !/^[a-zA-Z]:/u.test(filePath)
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

export function createMergeManager({
  workspaceRoot,
  applyAdapter,
  verifierRunner,
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const adapter = applyAdapter || createGitApplyAdapter({ workspaceRoot: resolvedWorkspaceRoot });

  return {
    async applyChampionMerge({
      champion = {},
      baseSha,
      approved = false,
      approvedBy = null,
      verifierCommands = [],
    } = {}) {
      const attemptId = champion.attemptId;
      const patch = patchForChampion(champion);
      const commands = verifierCommandsFor({ champion, verifierCommands });

      if (!approved) {
        return {
          attemptId,
          applied: false,
          status: 'approval_required',
          reason: 'missing_owner_approval',
        };
      }

      if (!patch) {
        return {
          attemptId,
          applied: false,
          status: 'missing_patch',
          reason: 'champion_patch_required',
        };
      }

      if (typeof verifierRunner !== 'function' || commands.length === 0) {
        return {
          attemptId,
          applied: false,
          status: 'verifier_rerun_required',
          verifierRerunRequired: true,
          reason: 'missing_verifier_runner_or_commands',
        };
      }

      const currentBaseSha = await currentHead(resolvedWorkspaceRoot);
      if (baseSha && currentBaseSha !== baseSha) {
        return {
          attemptId,
          applied: false,
          status: 'base_changed',
          reason: 'target_head_changed',
          requiresRebase: true,
          expectedBaseSha: baseSha,
          currentBaseSha,
        };
      }

      const { targetPaths, unsafePaths } = resolveTargetPaths({ workspaceRoot: resolvedWorkspaceRoot, patch });
      if (unsafePaths.length) {
        return {
          attemptId,
          applied: false,
          status: 'unsafe_patch',
          reason: 'unsafe_target_path',
          unsafePaths,
        };
      }

      let adapterResult;
      try {
        adapterResult = await adapter({
          patch,
          cwd: resolvedWorkspaceRoot,
          targetPaths,
          champion,
        });
      } catch (error) {
        return {
          attemptId,
          applied: false,
          status: 'textual_conflict',
          reason: 'git_apply_check_failed',
          conflict: {
            requiresManualResolution: true,
            targetPaths,
            message: error.message,
          },
        };
      }

      const verifierResult = await verifierRunner({
        cwd: resolvedWorkspaceRoot,
        commands,
        champion,
        approvedBy,
      });

      return {
        attemptId,
        applied: true,
        status: verifierResult?.passed === false ? 'verifier_failed' : 'applied',
        approvedBy,
        appliedAt: new Date().toISOString(),
        workspaceRoot: resolvedWorkspaceRoot,
        targetPaths,
        verifierRerunRequired: true,
        verifierResult,
        adapterResult,
      };
    },
  };
}

