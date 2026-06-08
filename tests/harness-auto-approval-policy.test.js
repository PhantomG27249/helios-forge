import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideAutoApproval } from '../src/harness-sidecar/meta/autoApprovalPolicy.js';
import { evaluatePromotion } from '../src/harness-sidecar/meta/promotionPolicy.js';
import { createApprovalResumeStore } from '../src/harness-sidecar/core/approvalResume.js';

test('auto approval keeps shadow-only candidates from mutation', () => {
  const decision = decideAutoApproval({
    candidate: { candidateId: 'shadow', status: 'shadow_only', changeType: 'local_config' },
    evidence: { heldOutPassed: true },
    rollback: { reversible: true },
  });

  assert.equal(decision.status, 'shadow_only');
  assert.equal(decision.tier, 'shadow_only');
  assert.equal(decision.reasons.includes('shadow_only_never_mutates'), true);
});

test('auto approval allows local reversible config with held-out pass and rollback metadata', () => {
  const decision = decideAutoApproval({
    candidate: { candidateId: 'local_config', status: 'candidate', changeType: 'local_config' },
    evidence: { heldOutPassed: true, baselinePassed: true },
    rollback: { reversible: true, restorePath: '.harness/config.backup.json' },
    trust: { tier: 'internal' },
  });

  assert.equal(decision.status, 'auto_approved');
  assert.equal(decision.tier, 'local_config_only');
  assert.equal(decision.reasons.includes('held_out_passed'), true);
  assert.equal(decision.reasons.includes('rollback_available'), true);
});

test('auto approval requires humans for branch mutation secrets write-scope and verifier weakening', () => {
  const cases = [
    [{ changeType: 'branch_mutation' }, 'branch_mutation_requires_human'],
    [{ changeType: 'local_config', containsSecrets: true }, 'secret_bearing_config_requires_human'],
    [{ changeType: 'mcp_write_scope_expansion' }, 'mcp_write_scope_expansion_requires_human'],
    [{ changeType: 'verifier_policy', weakensVerifierSafety: true }, 'verifier_safety_weakening_requires_human'],
  ];

  for (const [candidate, reason] of cases) {
    const decision = decideAutoApproval({
      candidate: { candidateId: reason, status: 'candidate', ...candidate },
      evidence: { heldOutPassed: true, baselinePassed: true },
      rollback: { reversible: true },
    });
    assert.equal(decision.status, 'human_required');
    assert.equal(decision.tier, 'human_required');
    assert.equal(decision.reasons.includes(reason), true);
  }
});

test('auto approval requires explicit approval for cost increases', () => {
  const blocked = decideAutoApproval({
    candidate: { candidateId: 'costly', changeType: 'local_config', costIncrease: 0.15 },
    evidence: { heldOutPassed: true, baselinePassed: true },
    rollback: { reversible: true },
  });
  const approved = decideAutoApproval({
    candidate: { candidateId: 'costly', changeType: 'local_config', costIncrease: 0.15 },
    evidence: { heldOutPassed: true, baselinePassed: true },
    rollback: { reversible: true },
    approvals: [{ allowCostIncrease: true }],
  });

  assert.equal(blocked.status, 'human_required');
  assert.equal(blocked.reasons.includes('cost_increase_requires_approval'), true);
  assert.equal(approved.status, 'auto_approved');
});

test('promotion and approval resume report auto approval eligibility as metadata only', () => {
  const promotion = evaluatePromotion({
    candidateRun: {
      candidateId: 'cand_local',
      smokePassed: true,
      changeType: 'local_config',
      metrics: { quality: 0.9, safety: 0.96, cost: 0.2, latency: 0.2 },
    },
    baselineFrontier: [{ quality: 0.8, safety: 0.9, cost: 0.4, latency: 0.4 }],
    approvals: [],
    autoApproval: {
      evidence: { heldOutPassed: true, baselinePassed: true },
      rollback: { reversible: true },
    },
  });
  const store = createApprovalResumeStore();
  const registered = store.register({
    actionId: 'act_auto',
    taskId: 'task_auto',
    kind: 'change_proposal_apply',
    autoApprovalEligibility: promotion.autoApprovalEligibility,
  });

  assert.equal(promotion.status, 'rejected');
  assert.equal(promotion.reasons.includes('missing_human_approval'), true);
  assert.equal(promotion.autoApprovalEligibility.status, 'auto_approved');
  assert.equal(registered.autoApprovalEligibility.status, 'auto_approved');
});
