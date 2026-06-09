import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateTrustKernelBoundary } from '../src/harness-sidecar/core/trustKernelBoundary.js';

test('rejects verifier policy floor weakening', () => {
  const decision = evaluateTrustKernelBoundary({
    proposal: { kind: 'verifier_policy', changes: { minVerifierPasses: 0 } },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'verifier_floor_weakened');
});

test('rejects global path mutation outside workspace', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    proposal: {
      kind: 'source_patch',
      requestedBy: 'local_meta_harness',
      paths: ['C:/Users/jackj/.codex/skills/global/SKILL.md'],
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'path_outside_workspace');
});

test('requires explicit approval for global meta harness source patches inside workspace', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    proposal: {
      kind: 'source_patch',
      requestedBy: 'global_meta_harness',
      paths: ['src/harness-sidecar/meta/promotionLoop.js'],
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresApproval, true);
});
