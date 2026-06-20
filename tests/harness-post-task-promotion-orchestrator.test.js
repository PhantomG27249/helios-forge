import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { promotionOrchestrationEnabled, runPostTaskPromotionOrchestrator } from '../src/harness-sidecar/meta/postTaskPromotionOrchestrator.js';

test('promotion orchestrator skips when disabled', async () => {
  const result = await runPostTaskPromotionOrchestrator({
    workspaceRoot: process.cwd(),
    harnessConfig: { evolution: { promotionOrchestration: false } },
    promotionBridgeResult: { queuePath: '/tmp/x.json' },
  });
  assert.equal(result.skipped, 'promotion_orchestration_disabled');
  assert.equal(result.canPromote, false);
});

test('promotion orchestrator writes audit trail when enabled', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'promo-orch-'));
  try {
    const queueDir = path.join(workspaceRoot, '.harness', 'meta', 'promotion-queue');
    await mkdir(queueDir, { recursive: true });
    const queuePath = path.join(queueDir, 'proposal-1.json');
    await writeFile(queuePath, '{}', 'utf8');

    const result = await runPostTaskPromotionOrchestrator({
      workspaceRoot,
      harnessConfig: { evolution: { promotionOrchestration: true } },
      promotionBridgeResult: {
        queuePath,
        candidateRun: { candidateId: 'c1', target: 'tool_policy' },
        proposal: { proposalId: 'proposal-1' },
      },
      deps: {
        runPromotionLoop: async () => ({
          auditEvents: [{ type: 'meta.candidate_proposed' }],
          decision: { status: 'pending_approval' },
          evidenceOnly: true,
          canPromote: false,
        }),
      },
    });

    assert.ok(result.auditPath);
    assert.equal(result.canPromote, false);
    assert.equal(promotionOrchestrationEnabled({ evolution: { promotionOrchestration: true } }), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
