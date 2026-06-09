import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runSwarmCell } from '../src/harness-sidecar/swarm/swarmCellRuntime.js';

test('SwarmCell runtime normalizes output and runs local meta harness when enabled', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-swarmcell-runtime-'));
  try {
    const result = await runSwarmCell({
      workspaceRoot,
      cell: {
        cellId: 'code',
        localMetaHarness: { enabled: true },
      },
      task: {
        taskId: 'task_1',
        goal: 'Exercise local meta harness runtime.',
      },
      attempt: {
        attemptId: 'a1',
        strategy: 'minimal',
      },
      commandAdapter: async () => ({
        summary: 'done',
        verifierEvidence: ['node --test'],
        evolutionOutput: {
          hardCaseTags: ['missing_context'],
          suggestedProfileChange: { contextBudget: 'larger' },
        },
      }),
    });

    assert.equal(result.taskOutput.summary, 'done');
    assert.deepEqual(result.evolutionOutput.hardCaseTags, ['missing_context']);
    assert.equal(result.contract.valid, true);
    assert.equal(result.localMeta.candidates.length, 1);
    assert.equal(result.localMeta.candidates[0].durableApplyApproved, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('SwarmCell runtime forwards verifier and memory policy suggestions to global review', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-swarmcell-runtime-'));
  try {
    const result = await runSwarmCell({
      workspaceRoot,
      cell: {
        cellId: 'verifier',
        localMetaHarness: { enabled: true, archive: false },
      },
      task: {
        taskId: 'task_2',
        goal: 'Preserve local evolution proposals.',
      },
      attempt: {
        attemptId: 'a2',
        strategy: 'guardrails',
      },
      commandAdapter: async () => ({
        summary: 'done',
        verifierEvidence: ['node --test'],
        evolutionOutput: {
          hardCaseTags: ['weak_verifier'],
          suggestedVerifierChange: { minVerifierPasses: 2 },
          suggestedMemoryPolicyChange: { promoteAfterSupport: 3 },
        },
      }),
    });

    const candidate = result.localMeta.candidates[0];
    assert.deepEqual(candidate.suggestedVerifierChange, { minVerifierPasses: 2 });
    assert.deepEqual(candidate.suggestedMemoryPolicyChange, { promoteAfterSupport: 3 });
    assert.equal(candidate.forwardToGlobal, true);
    assert.equal(candidate.reasons.includes('local_meta_harness_cannot_self_authorize'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
