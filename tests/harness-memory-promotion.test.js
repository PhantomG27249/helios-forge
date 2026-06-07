import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { retrievePromotedMemory } from '../src/harness-sidecar/memory/memoryRetriever.js';
import { createMemoryReviewQueue } from '../src/harness-sidecar/memory/memoryReviewQueue.js';
import { promoteMemoryCandidates } from '../src/harness-sidecar/memory/promotionPolicy.js';
import { createPromotedMemoryStore } from '../src/harness-sidecar/memory/promotedMemoryStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-memory-promotion-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function reviewedFix(overrides = {}) {
  return {
    memoryId: 'mem_reusable_fix_0001',
    type: 'reusable_fix',
    summary: 'Run node --test tests/harness-memory-promotion.test.js before full suite.',
    tags: ['node:test', 'harness'],
    taskKeywords: ['focused test', 'promotion'],
    evidence: ['tests/harness-memory-promotion.test.js'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
    provenance: [{ taskId: 'task_promote', evidence: ['tests/harness-memory-promotion.test.js'] }],
    ...overrides,
  };
}

test('promotion policy appends only evidence-backed reviewed validator-backed records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await promoteMemoryCandidates({
      workspaceRoot,
      candidates: [
        reviewedFix(),
        reviewedFix({
          memoryId: 'mem_pending_0001',
          reviewStatus: 'candidate',
          validatorBacked: false,
        }),
      ],
    });

    assert.deepEqual(result.promoted.map((record) => record.memoryId), ['mem_reusable_fix_0001']);
    assert.equal(result.reviewQueue.length, 1);
    assert.equal(result.reviewQueue[0].status, 'needs_review');

    const promoted = await createPromotedMemoryStore({ workspaceRoot }).list();
    assert.equal(promoted.length, 1);
    assert.equal(promoted[0].promotionStatus, 'promoted');
    assert.deepEqual(promoted[0].provenance, [{ taskId: 'task_promote', evidence: ['tests/harness-memory-promotion.test.js'] }]);
  });
});

test('promotion policy quarantines conflicts and stale records into review queue', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await promoteMemoryCandidates({
      workspaceRoot,
      candidates: [
        reviewedFix({
          memoryId: 'mem_conflict_0001',
          contradictions: ['mem_conflict_0002'],
        }),
        reviewedFix({
          memoryId: 'mem_stale_0001',
          stale: true,
          supersededBy: 'mem_reusable_fix_0002',
        }),
      ],
    });

    assert.equal(result.promoted.length, 0);
    assert.deepEqual(result.quarantined.map((record) => record.memoryId), ['mem_conflict_0001', 'mem_stale_0001']);
    assert.deepEqual(result.reviewQueue.map((entry) => entry.status), ['quarantined', 'quarantined']);
    assert.equal(result.reviewQueue[0].reasons.includes('contradiction_detected'), true);
    assert.equal(result.reviewQueue[1].reasons.includes('superseded'), true);
  });
});

test('memory review queue creates deterministic entries for needs-review and quarantined candidates', () => {
  const entries = createMemoryReviewQueue([
    {
      record: reviewedFix({ memoryId: 'mem_quarantine_0001' }),
      decision: { status: 'quarantined', reasons: ['contradiction_detected'] },
    },
    {
      record: reviewedFix({ memoryId: 'mem_review_0001' }),
      decision: { status: 'needs_review', reasons: ['validator_missing'] },
    },
    {
      record: reviewedFix({ memoryId: 'mem_promoted_0001' }),
      decision: { status: 'promotable', reasons: ['evidence_present'] },
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.memoryId), ['mem_quarantine_0001', 'mem_review_0001']);
  assert.equal(entries[0].queueId, 'review_mem_quarantine_0001');
  assert.equal(entries[0].priority, 0);
  assert.equal(entries[1].priority, 1);
});

test('promoted store appends, lists, and queries by type, tag, and task keyword', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createPromotedMemoryStore({ workspaceRoot });
    await store.append(reviewedFix({ memoryId: 'mem_fix_0001', tags: ['harness'], taskKeywords: ['promotion'] }));
    await store.append(reviewedFix({
      memoryId: 'mem_goal_0001',
      type: 'solved_subgoal',
      tags: ['graph'],
      taskKeywords: ['retrieval'],
    }));

    assert.deepEqual((await store.query({ type: 'reusable_fix' })).map((record) => record.memoryId), ['mem_fix_0001']);
    assert.deepEqual((await store.query({ tags: ['graph'] })).map((record) => record.memoryId), ['mem_goal_0001']);
    assert.deepEqual((await store.query({ taskKeywords: ['promotion'] })).map((record) => record.memoryId), ['mem_fix_0001']);

    const raw = await readFile(path.join(workspaceRoot, '.harness', 'memory', 'promoted.jsonl'), 'utf8');
    assert.equal(raw.trim().split('\n').length, 2);
  });
});

test('memory retriever returns context items with source, reason, provenance, and token estimates', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createPromotedMemoryStore({ workspaceRoot });
    await store.append(reviewedFix({
      memoryId: 'mem_fix_0001',
      type: 'reusable_fix',
      tags: ['harness'],
      taskKeywords: ['promotion', 'retrieval'],
      summary: 'Use promoted memory when implementing retrieval for harness tasks.',
    }));
    await store.append(reviewedFix({
      memoryId: 'mem_goal_0001',
      type: 'solved_subgoal',
      tags: ['unrelated'],
      taskKeywords: ['packaging'],
    }));

    const items = await retrievePromotedMemory({
      workspaceRoot,
      task: 'Implement promotion retrieval for the harness',
      type: 'reusable_fix',
      tags: ['harness'],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].memoryId, 'mem_fix_0001');
    assert.equal(items[0].source, 'promoted_memory');
    assert.equal(items[0].reason.includes('type:reusable_fix'), true);
    assert.equal(items[0].reason.includes('tag:harness'), true);
    assert.equal(items[0].reason.includes('task:promotion'), true);
    assert.deepEqual(items[0].provenance, [{ taskId: 'task_promote', evidence: ['tests/harness-memory-promotion.test.js'] }]);
    assert.equal(items[0].tokenEstimate > 0, true);
  });
});
