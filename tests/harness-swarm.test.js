import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { chooseChampion } from '../src/harness-sidecar/swarm/championSelector.js';
import { scheduleAttempts } from '../src/harness-sidecar/swarm/attemptScheduler.js';
import { WorktreeManager } from '../src/harness-sidecar/swarm/worktreeManager.js';
import { runShellCommand } from '../src/harness-sidecar/tools/shellBroker.js';

async function makeGitRepo() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'pi-swarm-repo-'));
  await runShellCommand({ command: 'git init', cwd: repoRoot, timeoutMs: 5000 });
  await writeFile(path.join(repoRoot, 'README.md'), 'swarm fixture\n');
  await runShellCommand({ command: 'git add README.md', cwd: repoRoot, timeoutMs: 5000 });
  await runShellCommand({ command: 'git commit -m "init"', cwd: repoRoot, timeoutMs: 5000 });
  return repoRoot;
}

test('worktree manager creates and removes isolated attempt worktrees', async () => {
  const repoRoot = await makeGitRepo();
  const harnessRoot = path.join(repoRoot, '.harness');
  await mkdir(harnessRoot, { recursive: true });
  const manager = new WorktreeManager({ workspaceRoot: repoRoot, harnessRoot });

  try {
    assert.equal(await manager.isGitRepo(), true);
    const attempt = await manager.createAttemptWorktree({
      taskId: 'task_swarm',
      attemptId: 'attempt_a',
    });

    await access(path.join(attempt.worktreePath, 'README.md'));
    assert.match(attempt.branchName, /harness\/task_swarm\/attempt_a/);

    await manager.removeAttemptWorktree(attempt);
    await assert.rejects(() => access(attempt.worktreePath));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('attempt scheduler creates strategy-scoped attempt records', () => {
  const attempts = scheduleAttempts({
    taskId: 'task_attempts',
    taskType: 'coding_bugfix',
    maxAttempts: 3,
  });

  assert.equal(attempts.length, 3);
  assert.equal(attempts[0].strategy, 'reproduce_first');
  assert.equal(attempts[0].status, 'pending');
});

test('champion selector prefers passing verifier result then smaller patch', () => {
  const champion = chooseChampion([
    { attemptId: 'a', verifierPassed: false, score: 90, patchStats: { changedLines: 5 } },
    { attemptId: 'b', verifierPassed: true, score: 50, patchStats: { changedLines: 20 } },
    { attemptId: 'c', verifierPassed: true, score: 50, patchStats: { changedLines: 8 } },
  ]);

  assert.equal(champion.attemptId, 'c');
});
