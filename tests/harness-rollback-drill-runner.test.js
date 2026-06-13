import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runRollbackDrill } from '../src/harness-sidecar/meta/rollbackDrillRunner.js';

test('rollback drill emits evidence-only passed output without promotion authority', () => {
  const drill = runRollbackDrill({
    now: '2026-06-12T10:00:00.000Z',
    candidate: {
      candidateId: 'local-config-a',
      candidateType: 'local_config',
      rollback: {
        reversible: true,
        restorePath: '.harness/rollback/local-config-a.json',
      },
    },
    verification: {
      restoreVerified: true,
      baselinePassed: true,
      postRollbackPassed: true,
      artifacts: ['.harness/rollback/local-config-a.json', '.harness/eval/post-rollback.json'],
    },
  });

  assert.equal(drill.drillId, 'rollback_local-config-a_20260612t100000000z');
  assert.equal(drill.candidateId, 'local-config-a');
  assert.equal(drill.evidenceOnly, true);
  assert.equal(drill.rollbackVerified, true);
  assert.deepEqual(drill.blockers, []);
  assert.equal(drill.canPromote, false);
  assert.equal(drill.status, 'passed');
  assert.equal(drill.rollback.reversible, true);
});

test('rollback drill reports blockers for missing rollback and failed verification', () => {
  const drill = runRollbackDrill({
    now: '2026-06-12T10:01:00.000Z',
    candidate: {
      candidateId: 'source-patch-a',
      candidateType: 'source_patch',
    },
    verification: {
      restoreVerified: false,
      baselinePassed: true,
      postRollbackPassed: false,
      artifacts: [],
    },
  });

  assert.equal(drill.evidenceOnly, true);
  assert.equal(drill.rollbackVerified, false);
  assert.deepEqual(drill.blockers, [
    'missing_reversible_rollback',
    'missing_rollback_artifact',
    'rollback_restore_not_verified',
    'post_rollback_verification_failed',
  ]);
  assert.equal(drill.canPromote, false);
  assert.equal(drill.status, 'failed');
});

test('rollback drill ignores candidate-supplied authority and trust-kernel bypass claims', () => {
  const drill = runRollbackDrill({
    now: '2026-06-12T10:02:00.000Z',
    candidate: {
      candidateId: 'unsafe-authority-a',
      candidateType: 'local_config',
      canPromote: true,
      evidenceOnly: false,
      trustKernelBypass: true,
      rollback: {
        reversible: true,
        restorePath: '.harness/rollback/unsafe-authority-a.json',
      },
    },
    verification: {
      restoreVerified: true,
      baselinePassed: true,
      postRollbackPassed: true,
      artifacts: ['.harness/rollback/unsafe-authority-a.json'],
    },
  });

  assert.equal(drill.evidenceOnly, true);
  assert.equal(drill.canPromote, false);
  assert.equal(drill.canBypassTrustKernel, false);
  assert.equal(drill.rollbackVerified, true);
  assert.deepEqual(drill.blockers, []);
});
