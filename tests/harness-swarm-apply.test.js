import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { applyChampion, proposeChampionApply } from '../src/harness-sidecar/swarm/championApply.js';
import { runCommandAttempt } from '../src/harness-sidecar/swarm/commandAttemptRunner.js';

test('command attempt adapter normalizes stdout stderr and exit code', async () => {
  const calls = [];
  const result = await runCommandAttempt({
    attempt: { attemptId: 'attempt_1', strategy: 'minimal_patch' },
    worktreePath: 'C:\\workspace\\.harness\\attempt_1',
    command: 'npm test -- --runInBand',
    commandAdapter: async (input) => {
      calls.push(input);
      return {
        stdout: 'diff --git a/src/harness-sidecar/swarm/a.js b/src/harness-sidecar/swarm/a.js\n+ok\n',
        stderr: 'warn: slow verifier\n',
        exitCode: 0,
        durationMs: 42,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, 'C:\\workspace\\.harness\\attempt_1');
  assert.equal(result.patch, 'diff --git a/src/harness-sidecar/swarm/a.js b/src/harness-sidecar/swarm/a.js\n+ok\n');
  assert.equal(result.score, 100);
  assert.deepEqual(result.patchStats, { changedLines: 1 });
  assert.deepEqual(result.verifierEvidence, [
    {
      command: 'npm test -- --runInBand',
      cwd: 'C:\\workspace\\.harness\\attempt_1',
      exitCode: 0,
      stdout: 'diff --git a/src/harness-sidecar/swarm/a.js b/src/harness-sidecar/swarm/a.js\n+ok\n',
      stderr: 'warn: slow verifier\n',
      durationMs: 42,
    },
  ]);
});

test('failed command attempt includes verifier evidence and zero score', async () => {
  const result = await runCommandAttempt({
    attempt: { attemptId: 'attempt_fail', strategy: 'reproduce_first' },
    worktreePath: '/tmp/attempt-fail',
    command: 'node --test tests/focused.test.js',
    commandAdapter: async () => ({
      stdout: 'TAP version 13\n',
      stderr: 'not ok 1 - focused failure\n',
      exitCode: 1,
    }),
  });

  assert.equal(result.score, 0);
  assert.deepEqual(result.patchStats, { changedLines: 0 });
  assert.equal(result.verifierEvidence[0].exitCode, 1);
  assert.match(result.verifierEvidence[0].stderr, /focused failure/);
});

test('champion apply refuses unapproved apply', async () => {
  const workspaceRoot = path.resolve('C:/workspace/chat-app');
  const champion = {
    attemptId: 'attempt_1',
    patch: 'diff --git a/src/harness-sidecar/swarm/a.js b/src/harness-sidecar/swarm/a.js\n+ok\n',
  };

  const plan = proposeChampionApply({ workspaceRoot, champion });
  assert.equal(plan.approvalRequired, true);
  assert.deepEqual(plan.targetPaths, [path.join(workspaceRoot, 'src/harness-sidecar/swarm/a.js')]);

  await assert.rejects(
    () => applyChampion({ workspaceRoot, champion, approved: false, applyAdapter: async () => ({}) }),
    /approval required/i,
  );
});

test('champion apply rejects unsafe patch paths', async () => {
  const workspaceRoot = path.resolve('C:/workspace/chat-app');
  const champion = {
    attemptId: 'attempt_escape',
    patch: 'diff --git a/../outside.txt b/../outside.txt\n+escape\n',
  };

  const plan = proposeChampionApply({ workspaceRoot, champion });
  assert.equal(plan.safe, false);
  assert.equal(plan.reasons.includes('unsafe_target_path'), true);

  await assert.rejects(
    () => applyChampion({ workspaceRoot, champion, approved: true, applyAdapter: async () => ({}) }),
    /unsafe target path/i,
  );
});

test('approved champion apply uses adapter and returns audit-ready result', async () => {
  const workspaceRoot = path.resolve('C:/workspace/chat-app');
  const champion = {
    attemptId: 'attempt_apply',
    output: {
      patch: 'diff --git a/src/harness-sidecar/swarm/championApply.js b/src/harness-sidecar/swarm/championApply.js\n+ok\n',
      verifierEvidence: ['node --test tests/harness-swarm-apply.test.js'],
    },
    score: 91,
  };
  const calls = [];

  const result = await applyChampion({
    workspaceRoot,
    champion,
    approved: true,
    approvedBy: 'coordinator',
    applyAdapter: async (input) => {
      calls.push(input);
      return { applied: true, stdout: 'applied cleanly', exitCode: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, workspaceRoot);
  assert.equal(calls[0].patch, champion.output.patch);
  assert.equal(result.applied, true);
  assert.equal(result.attemptId, 'attempt_apply');
  assert.equal(result.approvedBy, 'coordinator');
  assert.equal(result.adapterResult.stdout, 'applied cleanly');
  assert.deepEqual(result.verifierEvidence, ['node --test tests/harness-swarm-apply.test.js']);
  assert.deepEqual(result.targetPaths, [
    path.join(workspaceRoot, 'src/harness-sidecar/swarm/championApply.js'),
  ]);
});
