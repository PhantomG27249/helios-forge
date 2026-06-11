import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateTrustKernelBoundary } from '../src/harness-sidecar/core/trustKernelBoundary.js';
import { evaluatePromotion } from '../src/harness-sidecar/meta/promotionPolicy.js';

test('trust kernel blocks soul candidates that expand authority or hide lineage', () => {
  const authority = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'soul_mutation',
      changes: { toolAuthority: ['shell'], workspaceWriteScope: 'global' },
    },
  });
  const lineage = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'oversoul_mutation',
      changes: { hideLineage: true },
    },
  });

  assert.equal(authority.allowed, false);
  assert.equal(authority.reason, 'soul_authority_expansion_rejected');
  assert.equal(lineage.allowed, false);
  assert.equal(lineage.reason, 'soul_lineage_hide_rejected');
});

test('trust kernel blocks soul candidates that weaken governance or self approve', () => {
  const verifier = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'soul_mutation',
      changes: { minVerifierPasses: 0 },
    },
  });
  const audit = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'oversoul_mutation',
      changes: { auditEnabled: false },
    },
  });
  const redaction = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'soul_mutation',
      changes: { redactSecrets: false },
    },
  });
  const selfApproval = evaluateTrustKernelBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'oversoul_mutation',
      changes: { selfApprove: true },
    },
  });

  assert.equal(verifier.allowed, false);
  assert.equal(verifier.reason, 'verifier_floor_weakened');
  assert.equal(audit.allowed, false);
  assert.equal(audit.reason, 'audit_disable_rejected');
  assert.equal(redaction.allowed, false);
  assert.equal(redaction.reason, 'secret_redaction_disable_rejected');
  assert.equal(selfApproval.allowed, false);
  assert.equal(selfApproval.reason, 'soul_self_approval_rejected');
});

test('promotion policy keeps soul candidates shadow-only without full evidence and approval', () => {
  const rejected = evaluatePromotion({
    candidateRun: {
      candidateId: 'soul_candidate_1',
      target: 'soul_candidate',
      status: 'shadow_only',
      metrics: { safety: 1, quality: 1, cost: 1, latency: 1 },
      smokePassed: true,
      evidence: {
        replay: { passed: true },
        verifier: { passed: true },
        provenance: { traceId: 'trace_1' },
      },
      rollback: { available: true },
    },
    approvals: [{ candidateId: 'soul_candidate_1', choice: 'approve' }],
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reasons.includes('soul_shadow_only'), true);
  assert.equal(rejected.reasons.includes('soul_requires_operator_promotion_path'), true);
});
