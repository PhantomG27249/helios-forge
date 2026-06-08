import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateContextPolicyCandidate,
  proposeContextPolicies,
} from '../src/harness-sidecar/meta/contextPolicyEvolution.js';

test('context policy evolution treats missing context traces as shadow hard cases', () => {
  const candidates = proposeContextPolicies({
    coreset: [
      { caseId: 'trace_missing_context', reason: 'missing_context', relevanceGap: 0.7, noiseRatio: 0.1 },
    ],
    baselinePolicy: {
      lexicalWeight: 0.4,
      graphWeight: 0.2,
      memoryWeight: 0.2,
      recentTraceWeight: 0.2,
      maxContextItems: 8,
      maxTokens: 12000,
    },
  });

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].status, 'shadow_only');
  assert.equal(candidates[0].sourceCaseIds.includes('trace_missing_context'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('missing_context'), true);
});

test('context policy candidates include retrieval weights and budget limits', () => {
  const [candidate] = proposeContextPolicies({
    coreset: [{ caseId: 'rag_gap', reason: 'rag_miss', expectedSource: 'memory' }],
    baselinePolicy: { maxContextItems: 6, maxTokens: 9000 },
  });

  for (const field of ['lexicalWeight', 'graphWeight', 'memoryWeight', 'recentTraceWeight']) {
    assert.equal(typeof candidate[field], 'number');
  }
  assert.equal(Number.isInteger(candidate.maxContextItems), true);
  assert.equal(Number.isInteger(candidate.maxTokens), true);
  assert.equal(candidate.maxContextItems <= 12, true);
  assert.equal(candidate.maxTokens <= 16000, true);
});

test('context replay evaluation rewards relevant context and penalizes noise', () => {
  const candidate = {
    lexicalWeight: 0.2,
    graphWeight: 0.3,
    memoryWeight: 0.4,
    recentTraceWeight: 0.1,
    maxContextItems: 8,
    maxTokens: 12000,
    status: 'shadow_only',
  };

  const strong = evaluateContextPolicyCandidate({
    candidate,
    traceCase: { relevantItems: 6, noisyItems: 1, requiredItems: 6 },
  });
  const noisy = evaluateContextPolicyCandidate({
    candidate,
    traceCase: { relevantItems: 3, noisyItems: 8, requiredItems: 6 },
  });

  assert.equal(strong.score > noisy.score, true);
  assert.equal(strong.reasons.includes('relevant_context_recovered'), true);
  assert.equal(noisy.reasons.includes('context_noise_penalty'), true);
  assert.equal(strong.safety.status, 'shadow_only');
});
