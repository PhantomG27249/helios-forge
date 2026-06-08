import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateBudgetPolicyCandidate,
  proposeBudgetPolicies,
} from '../src/harness-sidecar/meta/budgetPolicyEvolution.js';
import { evaluateBudgetGates } from '../src/harness-sidecar/budget/gates.js';
import { recommendCostAwareAllocation } from '../src/harness-sidecar/budget/costAwareAllocator.js';

test('budget policy evolution treats budget exhaustion as shadow hard cases', () => {
  const candidates = proposeBudgetPolicies({
    coreset: [
      { caseId: 'budget_exhausted_trace', reason: 'budget_exhausted', confidence: 0.4 },
    ],
  });

  assert.equal(candidates[0].status, 'shadow_only');
  assert.equal(candidates[0].sourceCaseIds.includes('budget_exhausted_trace'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('budget_exhausted'), true);
});

test('budget candidates adjust verifier vlm retrieval and swarm spend', () => {
  const [candidate] = proposeBudgetPolicies({
    coreset: [{ caseId: 'low_confidence_visual', reason: 'low_confidence_verification', confidence: 0.32 }],
    baselinePolicy: {
      verifierSpend: 0.2,
      vlmSpend: 0.1,
      retrievalSpend: 0.3,
      swarmSpend: 0.2,
    },
  });

  assert.equal(candidate.verifierSpend > 0.2, true);
  assert.equal(candidate.vlmSpend >= 0.1, true);
  assert.equal(candidate.retrievalSpend >= 0.1, true);
  assert.equal(candidate.swarmSpend >= 0.1, true);
  assert.equal(candidate.status, 'shadow_only');
});

test('budget evaluator denies cost increases without explicit approval', () => {
  const blocked = evaluateBudgetPolicyCandidate({
    candidate: { costMultiplier: 1.25, verifierSpend: 0.4, status: 'shadow_only' },
    budgetCase: { confidence: 0.8 },
  });
  const approved = evaluateBudgetPolicyCandidate({
    candidate: { costMultiplier: 1.25, verifierSpend: 0.4, status: 'shadow_only' },
    budgetCase: { confidence: 0.8 },
    approvals: [{ allowCostIncrease: true }],
  });

  assert.equal(blocked.safety.status, 'human_required');
  assert.equal(blocked.promotable, false);
  assert.equal(blocked.reasons.includes('cost_increase_requires_approval'), true);
  assert.equal(approved.reasons.includes('cost_increase_approved'), true);
});

test('low confidence replay escalates verification budget', () => {
  const decision = evaluateBudgetPolicyCandidate({
    candidate: { verifierSpend: 0.45, costMultiplier: 1, status: 'shadow_only' },
    budgetCase: { confidence: 0.25 },
  });

  assert.equal(decision.reasons.includes('low_confidence_verifier_budget_escalated'), true);
  assert.equal(decision.score > 0.5, true);
});

test('budget policy metadata is optional for allocators and gates', () => {
  const defaultAllocation = recommendCostAwareAllocation({
    pressure: { budgetPercent: 92 },
    desired: { retrievalItems: 8, subagents: 4, modelProfile: 'large' },
  });
  const policyAllocation = recommendCostAwareAllocation({
    pressure: { budgetPercent: 92 },
    desired: { retrievalItems: 8, subagents: 4, modelProfile: 'large' },
    policy: { policyId: 'budget_shadow', status: 'shadow_only' },
  });
  const gate = evaluateBudgetGates({
    used: { toolCalls: 9 },
    limits: { maxToolCalls: 10 },
    policy: { policyId: 'budget_shadow', status: 'shadow_only' },
  });

  assert.equal(defaultAllocation.policy, undefined);
  assert.deepEqual(policyAllocation.policy, { policyId: 'budget_shadow', status: 'shadow_only', mode: 'metadata_only' });
  assert.deepEqual(gate.policy, { policyId: 'budget_shadow', status: 'shadow_only', mode: 'metadata_only' });
});
