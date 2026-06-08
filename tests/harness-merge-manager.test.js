import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { createMergeManager } from '../src/harness-sidecar/collaboration/mergeManager.js';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (exitCode === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`));
      }
    });
  });
}

async function commitAll(workspaceRoot, message) {
  await run('git', ['add', '.'], workspaceRoot);
  await run('git', ['commit', '-m', message], workspaceRoot);
}

async function currentHead(workspaceRoot) {
  const result = await run('git', ['rev-parse', 'HEAD'], workspaceRoot);
  return result.stdout.trim();
}

async function withGitWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-merge-manager-'));
  try {
    await run('git', ['init'], workspaceRoot);
    await run('git', ['config', 'user.email', 'test@example.invalid'], workspaceRoot);
    await run('git', ['config', 'user.name', 'Helios Test'], workspaceRoot);
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'src', 'a.js'), 'export const value = 1;\n');
    await commitAll(workspaceRoot, 'init');
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function valuePatch(fromValue, toValue) {
  return [
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1 +1 @@',
    `-export const value = ${fromValue};`,
    `+export const value = ${toValue};`,
    '',
  ].join('\n');
}

test('merge manager cleanly applies a champion patch and reruns verifiers', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const baseSha = await currentHead(workspaceRoot);
    const verifierCalls = [];
    const manager = createMergeManager({
      workspaceRoot,
      verifierRunner: async (input) => {
        verifierCalls.push(input);
        return { passed: true, evidence: [{ command: input.commands[0], exitCode: 0 }] };
      },
    });

    const result = await manager.applyChampionMerge({
      champion: {
        attemptId: 'attempt_clean',
        patch: valuePatch(1, 2),
        verifierCommands: ['node --test tests/focused.test.js'],
      },
      baseSha,
      approved: true,
      approvedBy: 'owner',
    });

    assert.equal(result.status, 'applied');
    assert.equal(result.applied, true);
    assert.equal(result.verifierRerunRequired, true);
    assert.equal(result.verifierResult.passed, true);
    assert.equal(verifierCalls.length, 1);
    assert.equal(verifierCalls[0].cwd, workspaceRoot);
    assert.deepEqual(verifierCalls[0].commands, ['node --test tests/focused.test.js']);
    assert.equal(
      (await readFile(path.join(workspaceRoot, 'src', 'a.js'), 'utf8')).replace(/\r\n/g, '\n'),
      'export const value = 2;\n',
    );
  });
});

test('merge manager refuses to apply when the target base has changed', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const baseSha = await currentHead(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'README.md'), 'base moved\n');
    await commitAll(workspaceRoot, 'move base');
    const manager = createMergeManager({
      workspaceRoot,
      verifierRunner: async () => ({ passed: true, evidence: [] }),
    });

    const result = await manager.applyChampionMerge({
      champion: {
        attemptId: 'attempt_stale',
        patch: valuePatch(1, 2),
        verifierCommands: ['node --test tests/focused.test.js'],
      },
      baseSha,
      approved: true,
      approvedBy: 'owner',
    });

    assert.equal(result.applied, false);
    assert.equal(result.status, 'base_changed');
    assert.equal(result.reason, 'target_head_changed');
    assert.equal(result.requiresRebase, true);
    assert.equal(result.expectedBaseSha, baseSha);
    assert.equal(result.currentBaseSha, await currentHead(workspaceRoot));
  });
});

test('merge manager reports textual conflicts without changing conflicted files', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const baseSha = await currentHead(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'src', 'a.js'), 'export const value = 9;\n');
    const manager = createMergeManager({
      workspaceRoot,
      verifierRunner: async () => ({ passed: true, evidence: [] }),
    });

    const result = await manager.applyChampionMerge({
      champion: {
        attemptId: 'attempt_conflict',
        patch: valuePatch(1, 2),
        verifierCommands: ['node --test tests/focused.test.js'],
      },
      baseSha,
      approved: true,
      approvedBy: 'owner',
    });

    assert.equal(result.applied, false);
    assert.equal(result.status, 'textual_conflict');
    assert.equal(result.conflict.requiresManualResolution, true);
    assert.deepEqual(result.conflict.targetPaths, [path.join(workspaceRoot, 'src', 'a.js')]);
    assert.equal(await readFile(path.join(workspaceRoot, 'src', 'a.js'), 'utf8'), 'export const value = 9;\n');
  });
});

test('merge manager requires verifier rerun before applying champion patches', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const baseSha = await currentHead(workspaceRoot);
    const manager = createMergeManager({ workspaceRoot });

    const result = await manager.applyChampionMerge({
      champion: {
        attemptId: 'attempt_no_verifier',
        patch: valuePatch(1, 2),
      },
      baseSha,
      approved: true,
      approvedBy: 'owner',
    });

    assert.deepEqual(result, {
      attemptId: 'attempt_no_verifier',
      applied: false,
      status: 'verifier_rerun_required',
      verifierRerunRequired: true,
      reason: 'missing_verifier_runner_or_commands',
    });
    assert.equal(await readFile(path.join(workspaceRoot, 'src', 'a.js'), 'utf8'), 'export const value = 1;\n');
  });
});
