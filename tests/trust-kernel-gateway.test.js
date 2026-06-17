import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateProposalTrustBoundary } from '../src/harness-sidecar/core/trustKernelGateway.js';

test('gateway wraps trust kernel with governance-friendly envelope', () => {
  const result = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: { kind: 'source_patch', paths: ['../outside.js'] },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.authority, 'evidence_only');
  assert.equal(result.boundary.authority, 'evidence_only');
  assert.ok(result.reasons.length > 0);
});

test('gateway passes valid workspace-local proposals', () => {
  const result = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'local_config',
      paths: ['src/harness-sidecar/meta/promotionPolicy.js'],
      risk: 'low',
    },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.boundary.authority, 'evidence_only');
});

test('gateway surfaces approval-required proposals from trust kernel', () => {
  const result = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'source_patch',
      paths: ['src/harness-sidecar/meta/promotionPolicy.js'],
    },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.boundary.requiresApproval, true);
  assert.ok(result.reasons.some((reason) => reason.includes('requires_approval')));
});
