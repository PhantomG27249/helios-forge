import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listPromotionQueueRecords } from '../src/harness-sidecar/meta/promotionQueueReader.js';

test('listPromotionQueueRecords returns read-only queue summaries', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'promo-queue-'));
  try {
    const queueDir = path.join(workspaceRoot, '.harness', 'meta', 'promotion-queue');
    await mkdir(queueDir, { recursive: true });
    await writeFile(path.join(queueDir, 'p1.json'), JSON.stringify({
      proposalId: 'p1',
      queuedAt: '2026-06-20T00:00:00.000Z',
      candidateRun: { candidateId: 'c1', target: 'tool_policy' },
      decision: { status: 'pending_approval' },
    }), 'utf8');

    const records = await listPromotionQueueRecords({ workspaceRoot });
    assert.equal(records.length, 1);
    assert.equal(records[0].proposalId, 'p1');
    assert.equal(records[0].canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
