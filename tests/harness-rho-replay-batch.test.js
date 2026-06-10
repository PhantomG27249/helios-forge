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
    verifierEvidence: [{ passed: true }],
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

test('compares candidate families across held-out variants with validation consistency and blocking evidence', async () => {
  const result = await runRhoReplayBatch({
    coreset: {
      items: [{
        taskId: 'case_family',
        prompt: 'repair harness',
        heldoutVariants: [{ variantId: 'seed_a' }, { variantId: 'seed_b' }],
      }],
    },
    groupSize: 2,
    baselineRunner: async ({ heldoutVariant, rolloutIndex }) => ({
      status: 'completed',
      compactHandoff: {
        summary: `baseline:${heldoutVariant.variantId}:${rolloutIndex}`,
        testsRun: ['npm test'],
      },
      verifierEvidence: [{ passed: true, rolloutIndex }],
    }),
    candidateFamily: [
      {
        candidateId: 'cand_stable',
        runner: async ({ candidate, heldoutVariant, rolloutIndex }) => ({
          status: 'completed',
          compactHandoff: {
            summary: `${candidate.candidateId}:${heldoutVariant.variantId}`,
            testsRun: ['npm test'],
          },
          verifierEvidence: [{ passed: true, rolloutIndex }],
        }),
      },
      {
        candidateId: 'cand_fragile',
        runner: async ({ candidate, heldoutVariant, rolloutIndex }) => ({
          status: heldoutVariant.variantId === 'seed_b' && rolloutIndex === 1 ? 'failed' : 'completed',
          compactHandoff: {
            summary: `${candidate.candidateId}:${heldoutVariant.variantId}:${rolloutIndex}`,
            testsRun: heldoutVariant.variantId === 'seed_b' && rolloutIndex === 1
              ? [{ command: 'npm test', status: 'failed', passed: false }]
              : ['npm test'],
          },
          verifierEvidence: [{ passed: !(heldoutVariant.variantId === 'seed_b' && rolloutIndex === 1) }],
        }),
      },
    ],
  });

  const replayCase = result.cases[0];
  assert.deepEqual(replayCase.heldoutVariants.map((variant) => variant.variantId), ['seed_a', 'seed_b']);
  assert.equal(replayCase.baseline.rollouts.length, 4);
  assert.deepEqual(replayCase.candidateFamily.map((candidate) => candidate.candidateId), [
    'cand_stable',
    'cand_fragile',
  ]);
  assert.equal(replayCase.candidateFamily[0].validation.passedCount, 4);
  assert.equal(replayCase.candidateFamily[1].validation.passed, false);
  assert.equal(replayCase.preferences[0].candidateId, 'cand_stable');
  assert.equal(replayCase.preferences[0].preferred, 'candidate');
  assert.equal(replayCase.preferences[1].blockingEvidence.includes('validation_failed'), true);
  assert.equal(result.familySummary.preferredCandidateId, 'cand_stable');
});

test('selects candidate-family winner from aggregate replay performance across cases', async () => {
  const result = await runRhoReplayBatch({
    coreset: {
      items: [
        { taskId: 'case_one' },
        { taskId: 'case_two' },
      ],
    },
    baselineRunner: async () => ({
      status: 'completed',
      compactHandoff: { summary: 'baseline', testsRun: ['npm test'] },
      verifierEvidence: [{ passed: true }],
    }),
    candidateFamily: [
      {
        candidateId: 'cand_flashy',
        runner: async ({ item }) => {
          const passed = item.taskId === 'case_one';
          return {
            status: passed ? 'completed' : 'failed',
            compactHandoff: {
              summary: passed ? 'huge win' : 'missed second case',
              testsRun: passed ? ['npm test'] : [{ command: 'npm test', status: 'failed', passed: false }],
            },
            verifierEvidence: [{ passed }],
          };
        },
      },
      {
        candidateId: 'cand_steady',
        runner: async () => ({
          status: 'completed',
          compactHandoff: { summary: 'steady pass', testsRun: ['npm test'] },
          verifierEvidence: [{ passed: true }],
        }),
      },
    ],
  });

  assert.equal(result.familySummary.preferredCandidateId, 'cand_steady');
  assert.equal(
    result.familySummary.rankings.find((entry) => entry.candidateId === 'cand_flashy').blockingEvidence.includes('validation_failed'),
    true,
  );
});

test('emits aggregate candidate-family preference evidence without promotion authority', async () => {
  const result = await runRhoReplayBatch({
    coreset: {
      items: [
        { taskId: 'case_alpha', heldoutVariants: [{ variantId: 'seed_1' }, { variantId: 'seed_2' }] },
        { taskId: 'case_beta', heldoutVariants: [{ variantId: 'seed_1' }, { variantId: 'seed_2' }] },
      ],
    },
    groupSize: 3,
    baselineRunner: async ({ heldoutVariant, rolloutIndex }) => ({
      status: 'completed',
      compactHandoff: {
        summary: `baseline:${heldoutVariant.variantId}:${rolloutIndex}`,
        testsRun: ['npm test'],
      },
      verifierEvidence: [{ passed: true }],
    }),
    candidateFamily: [
      {
        candidateId: 'cand_consistent',
        runner: async ({ candidate, item }) => ({
          status: 'completed',
          compactHandoff: {
            summary: `${candidate.candidateId}:${item.taskId}:stable`,
            testsRun: ['npm test'],
          },
          verifierEvidence: [{ passed: true }],
        }),
      },
      {
        candidateId: 'cand_blocked',
        runner: async ({ rolloutIndex }) => ({
          status: rolloutIndex === 2 ? 'failed' : 'completed',
          compactHandoff: {
            summary: `blocked:${rolloutIndex}`,
            testsRun: rolloutIndex === 2
              ? [{ command: 'npm test', status: 'failed', passed: false }]
              : ['npm test'],
          },
          verifierEvidence: [{ passed: rolloutIndex !== 2 }],
        }),
      },
    ],
  });

  const consistent = result.familySummary.rankings.find((entry) => entry.candidateId === 'cand_consistent');
  const blocked = result.familySummary.rankings.find((entry) => entry.candidateId === 'cand_blocked');

  assert.equal(result.groupSize, 3);
  assert.equal(result.familySummary.promotionAllowed, false);
  assert.equal(result.familySummary.authority, 'evidence_only');
  assert.equal(consistent.aggregate.rerollCount, 12);
  assert.equal(consistent.aggregate.caseWinRate, 1);
  assert.equal(consistent.aggregate.validationPassRate, 1);
  assert.equal(consistent.promotionEvidence.includes('candidate_family_majority_preferred'), true);
  assert.equal(consistent.promotionEvidence.includes('grouped_reroll_evidence'), true);
  assert.equal(consistent.promotionAllowed, false);
  assert.equal(blocked.blockingEvidence.includes('validation_failed'), true);
  assert.equal(blocked.blockingEvidence.includes('aggregate_validation_failed'), true);
  assert.equal(blocked.promotionEvidence.includes('candidate_family_majority_preferred'), false);
});
