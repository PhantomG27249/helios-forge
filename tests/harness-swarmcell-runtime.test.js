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
