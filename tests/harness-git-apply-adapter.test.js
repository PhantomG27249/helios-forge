import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { createGitApplyAdapter } from '../src/harness-sidecar/tools/gitApplyAdapter.js';

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

async function withGitWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-git-apply-'));
  try {
    await run('git', ['init'], workspaceRoot);
    await run('git', ['config', 'user.email', 'test@example.invalid'], workspaceRoot);
    await run('git', ['config', 'user.name', 'Helios Test'], workspaceRoot);
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'src', 'a.js'), 'export const value = 1;\n');
    await run('git', ['add', '.'], workspaceRoot);
    await run('git', ['commit', '-m', 'init'], workspaceRoot);
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('git apply adapter checks and applies a safe patch to the current branch worktree', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const adapter = createGitApplyAdapter({ workspaceRoot });

    const result = await adapter({
      cwd: workspaceRoot,
      patch: [
        'diff --git a/src/a.js b/src/a.js',
        '--- a/src/a.js',
        '+++ b/src/a.js',
        '@@ -1 +1 @@',
        '-export const value = 1;',
        '+export const value = 2;',
        '',
      ].join('\n'),
      targetPaths: [path.join(workspaceRoot, 'src', 'a.js')],
    });

    assert.equal(result.applied, true);
    assert.equal(result.checked, true);
    assert.equal(result.branch.length > 0, true);
    assert.equal(
      (await readFile(path.join(workspaceRoot, 'src', 'a.js'), 'utf8')).replace(/\r\n/g, '\n'),
      'export const value = 2;\n',
    );
  });
});

test('git apply adapter rejects target paths outside the workspace', async () => {
  await withGitWorkspace(async ({ workspaceRoot }) => {
    const adapter = createGitApplyAdapter({ workspaceRoot });

    await assert.rejects(
      () => adapter({
        cwd: workspaceRoot,
        patch: 'diff --git a/src/a.js b/src/a.js\n',
        targetPaths: [path.resolve(workspaceRoot, '..', 'outside.js')],
      }),
      /target path outside workspace/,
    );
  });
});
