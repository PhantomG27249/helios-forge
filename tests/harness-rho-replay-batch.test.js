import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runRhoReplayBatch } from '../src/harness-sidecar/rho/replayBatchRunner.js';
import { scoreSelfConsistency } from '../src/harness-sidecar/rho/selfConsistency.js';
import { judgeSelfPreference } from '../src/harness-sidecar/rho/selfPreferenceJudge.js';
import { scoreSelfValidation } from '../src/harness-sidecar/rho/selfValidation.js';

test('passes self-validation from completed status and verifier evidence', () => {
  const result = scoreSelfValidation({
    status: 'completed',
    verifierEvidence: [{ passed: true }],
    compactHandoff: { summary: 'done', testsRun: ['npm test'] },
  });

  assert.equal(result.passed, true);
  assert.equal(result.reason, 'verifier_passed');
});

test('self-validation does not pass failed test evidence', () => {
  const result = scoreSelfValidation({
    status: 'completed',
    compactHandoff: {
      summary: 'tests failed',
      testsRun: [{ command: 'npm test', status: 'failed', passed: false }],
    },
  });

  assert.equal(result.passed, false);
  assert.equal(result.reasons.includes('tests_failed'), true);
});

test('scores self-consistency from majority normalized summaries', () => {
  const result = scoreSelfConsistency({
    rollouts: [
      { compactHandoff: { summary: 'use local meta harness' } },
      { compactHandoff: { summary: 'different' } },
      { compactHandoff: { summary: 'Use local meta harness' } },
    ],
  });

  assert.equal(result.consistent, true);
  assert.equal(result.majorityCount, 2);
});

test('self-consistency counts blank rollout summaries against agreement', () => {
  const result = scoreSelfConsistency({
    rollouts: [
      { output: { summary: 'same' } },
      { output: {} },
      {},
    ],
  });

  assert.equal(result.total, 3);
  assert.equal(result.consistent, false);
  assert.equal(result.groups.some((group) => group.summary === '__missing_summary__' && group.count === 2), true);
});

test('runs grouped replay batches for baseline and candidate variants', async () => {
  const result = await runRhoReplayBatch({
    coreset: { items: [{ taskId: 'case_1', prompt: 'repair harness' }] },
    groupSize: 2,
    baselineRunner: async ({ item, rolloutIndex, variant }) => ({
      status: 'completed',
      compactHandoff: { summary: `${variant}:${item.taskId}`, testsRun: ['npm test'] },
      verifierEvidence: [{ passed: rolloutIndex >= 0 }],
    }),
    candidateRunner: async ({ item, rolloutIndex, variant }) => ({
      status: 'completed',
      compactHandoff: { summary: `${variant}:${item.taskId}`, testsRun: ['npm test'] },
      verifierEvidence: [{ passed: rolloutIndex >= 0 }],
    }),
  });

  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].baseline.rollouts.length, 2);
  assert.equal(result.cases[0].candidate.rollouts.length, 2);
  assert.equal(result.cases[0].baseline.validation.passedCount, 2);
  assert.equal(result.cases[0].candidate.consistency.consistent, true);
});

test('judges self-preference from validation and consistency scores', () => {
  const result = judgeSelfPreference({
    baseline: { validation: { score: 1 }, consistency: { score: 0.5 } },
    candidate: { validation: { score: 2 }, consistency: { score: 1 } },
  });

  assert.equal(result.preferred, 'candidate');
  assert.equal(result.scoreDelta > 0, true);
  assert.equal(result.reasons.includes('candidate_validation'), true);
  assert.equal(result.reasons.includes('candidate_consistency'), true);
});
