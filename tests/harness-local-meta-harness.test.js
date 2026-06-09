import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { archiveLocalCandidate } from '../src/harness-sidecar/meta/localCandidateArchive.js';
import { runLocalEvolutionLoop } from '../src/harness-sidecar/meta/localEvolutionLoop.js';
import { runLocalMetaHarness } from '../src/harness-sidecar/meta/localMetaHarness.js';
import { blockLocalDurablePromotion } from '../src/harness-sidecar/meta/localPromotionBlocker.js';

test('local meta harness blocks durable self-approval and forwards global changes', () => {
  const blocked = blockLocalDurablePromotion({
    candidateId: 'local_code_1',
    durableApplyApproved: true,
    suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
  });

  assert.equal(blocked.durableApplyApproved, false);
  assert.equal(blocked.forwardToGlobal, true);
  assert.equal(blocked.reasons.includes('local_meta_harness_cannot_self_authorize'), true);
});

test('archives local candidates under the scoped cell directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-local-candidate-'));
  try {
    const record = await archiveLocalCandidate({
      workspaceRoot,
      cellId: 'code',
      candidate: {
        candidateId: 'lc_1',
        mutationType: 'prompt_reorder',
      },
      evidence: {
        traceRefs: ['trace:1'],
      },
    });
    const saved = JSON.parse(await readFile(record.recordPath, 'utf8'));

    assert.equal(saved.cellId, 'code');
    assert.equal(saved.candidateId, 'lc_1');
    assert.equal(saved.candidate.candidateId, 'lc_1');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('local evolution loop turns hard cases into local scoped candidates', () => {
  const result = runLocalEvolutionLoop({
    cellId: 'code',
    attempt: {
      attemptId: 'a1',
      status: 'completed',
      evolutionOutput: {
        hardCaseTags: ['missing_context'],
        suggestedProfileChange: { contextBudget: 'larger' },
      },
    },
  });

  assert.equal(result.cellId, 'code');
  assert.deepEqual(result.hardCaseTags, ['missing_context']);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidateId, 'local_code_1');
  assert.equal(result.candidates[0].scope, 'local');
  assert.equal(result.candidates[0].durableApplyApproved, false);
});

test('local meta harness archives candidates without approving durable apply', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-local-meta-'));
  try {
    const result = await runLocalMetaHarness({
      workspaceRoot,
      cell: {
        cellId: 'code',
      },
      attempt: {
        attemptId: 'a1',
        status: 'completed',
        evolutionOutput: {
          hardCaseTags: ['missing_context'],
          suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
        },
      },
    });

    assert.equal(result.cellId, 'code');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].durableApplyApproved, false);
    assert.equal(result.candidates[0].forwardToGlobal, true);
    assert.equal(result.archiveRecords.length, 1);
    assert.equal(result.auditEvents.some((event) => event.type === 'local_meta.candidates_archived'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
