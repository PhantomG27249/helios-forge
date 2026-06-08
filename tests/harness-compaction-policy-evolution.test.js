import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateCompactionPolicyCandidate,
  proposeCompactionPolicies,
} from '../src/harness-sidecar/meta/compactionPolicyEvolution.js';
import { HarnessOptimizer } from '../src/harness-sidecar/meta/harnessOptimizer.js';

test('compaction policy evolution treats compaction hard cases as shadow candidates', () => {
  const candidates = proposeCompactionPolicies({
    coreset: [
      { caseId: 'resume_gap', reason: 'compaction_continuation_failed', lostConstraints: ['no web'] },
      { caseId: 'bloated_summary', reason: 'compaction_token_bloat', tokenReduction: 0.08 },
    ],
    baselinePolicy: {
      preserveConstraintWeight: 0.45,
      continuationWeight: 0.35,
      tokenReductionWeight: 0.2,
      maxSummaryTokens: 8000,
    },
  });

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].status, 'shadow_only');
  assert.equal(candidates[0].sourceCaseIds.includes('resume_gap'), true);
  assert.equal(candidates[0].sourceCaseIds.includes('bloated_summary'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('compaction_continuation_failed'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('compaction_token_bloat'), true);
  assert.equal(candidates[0].directApplyAllowed, false);
});

test('compaction policy candidates preserve constraints while tightening summary tokens', () => {
  const [candidate] = proposeCompactionPolicies({
    coreset: [{ caseId: 'lost_constraints', reason: 'compaction_lost_constraints' }],
    baselinePolicy: {
      preserveConstraintWeight: 0.5,
      continuationWeight: 0.3,
      tokenReductionWeight: 0.2,
      maxSummaryTokens: 10000,
      replayWindowEvents: 80,
    },
  });

  assert.equal(candidate.preserveConstraintWeight > 0.5, true);
  assert.equal(candidate.continuationWeight >= 0.3, true);
  assert.equal(candidate.tokenReductionWeight >= 0.2, true);
  assert.equal(candidate.maxSummaryTokens < 10000, true);
  assert.equal(Number.isInteger(candidate.replayWindowEvents), true);
  assert.equal(candidate.requiresApproval, true);
});

test('compaction replay evaluation rewards continuation success and token reduction', () => {
  const candidate = {
    preserveConstraintWeight: 0.65,
    continuationWeight: 0.45,
    tokenReductionWeight: 0.35,
    maxSummaryTokens: 7000,
    status: 'shadow_only',
  };

  const strong = evaluateCompactionPolicyCandidate({
    candidate,
    replayCase: {
      continuationSucceeded: true,
      beforeTokens: 12000,
      afterTokens: 6500,
      lostConstraints: [],
      hallucinations: [],
    },
  });
  const unsafe = evaluateCompactionPolicyCandidate({
    candidate,
    replayCase: {
      continuationSucceeded: false,
      beforeTokens: 12000,
      afterTokens: 6200,
      lostConstraints: ['no external API calls'],
      hallucinations: ['invented approval'],
    },
  });

  assert.equal(strong.score > unsafe.score, true);
  assert.equal(strong.reasons.includes('continuation_success'), true);
  assert.equal(strong.reasons.includes('token_reduction'), true);
  assert.equal(unsafe.reasons.includes('lost_constraints_penalty'), true);
  assert.equal(unsafe.reasons.includes('hallucination_penalty'), true);
  assert.equal(strong.safety.status, 'shadow_only');
  assert.equal(strong.promotable, false);
});

test('harness optimizer routes compaction policy targets to shadow evolution', () => {
  const result = new HarnessOptimizer({ mode: 'rho-meta' }).propose({
    target: 'compaction_policy',
    coreset: {
      items: [
        { caseId: 'resume_gap', reasons: ['compaction_continuation_failed'] },
      ],
    },
  });

  assert.equal(result.candidates.length > 0, true);
  assert.equal(result.candidates[0].target, 'compaction_policy');
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].requiresApproval, true);
});
