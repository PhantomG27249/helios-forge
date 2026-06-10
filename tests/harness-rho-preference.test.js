import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeCandidatePreference } from '../src/harness-sidecar/rho/preferenceJudge.js';
import { judgeSelfPreference } from '../src/harness-sidecar/rho/selfPreferenceJudge.js';

test('prefers higher quality and safety with lower cost and latency', () => {
  const result = judgeCandidatePreference({
    candidates: [
      {
        candidateId: 'cand_slow',
        metrics: { quality: 0.72, safety: 0.8, cost: 0.8, latency: 0.7 },
      },
      {
        candidateId: 'cand_balanced',
        metrics: { quality: 0.86, safety: 0.95, cost: 0.35, latency: 0.3 },
      },
    ],
    coreset: { items: [{ taskId: 'timeout', score: 7, reasons: ['budget_gate'] }] },
  });

  assert.equal(result.winner.candidateId, 'cand_balanced');
  assert.deepEqual(result.rankings.map((ranking) => ranking.candidateId), [
    'cand_balanced',
    'cand_slow',
  ]);
  assert.equal(result.rankings[0].votes, 1);
  assert.match(result.rankings[0].reasons.join(' '), /quality/);
  assert.match(result.rankings[0].reasons.join(' '), /safety/);
  assert.equal(result.pairwise[0].winner, 'cand_balanced');
  assert.equal(result.pairwise[0].delta > 0, true);
  assert.match(result.rationale, /cand_balanced/);
});

test('uses self-consistency votes when pairwise comparisons are close', () => {
  const result = judgeCandidatePreference({
    candidates: [
      {
        candidateId: 'cand_reliable',
        metrics: { quality: 0.82, safety: 0.95, cost: 0.52, latency: 0.5 },
        validations: [
          { passed: true },
          { passed: true },
          { passed: true },
        ],
      },
      {
        candidateId: 'cand_fast',
        metrics: { quality: 0.84, safety: 0.91, cost: 0.48, latency: 0.47 },
        validations: [
          { passed: true },
          { passed: false },
          { passed: false },
        ],
      },
    ],
    coreset: { items: [{ taskId: 'retrieval', score: 5, reasons: ['failure_or_recovery'] }] },
  });

  assert.equal(result.winner.candidateId, 'cand_reliable');
  assert.equal(result.rankings[0].votes, 2);
  assert.equal(result.rankings[1].votes, 0);
  assert.match(result.pairwise[0].reason, /self-consistency/);
});

test('returns score deltas and breaks exact ties by candidate id', () => {
  const result = judgeCandidatePreference({
    candidates: [
      {
        candidateId: 'cand_b',
        metrics: { quality: 0.8, safety: 0.8, cost: 0.4, latency: 0.4 },
      },
      {
        candidateId: 'cand_a',
        metrics: { quality: 0.8, safety: 0.8, cost: 0.4, latency: 0.4 },
      },
    ],
    objectives: { quality: 1, safety: 1, cost: 1, latency: 1 },
  });

  assert.equal(result.winner.candidateId, 'cand_a');
  assert.deepEqual(result.rankings.map((ranking) => ranking.candidateId), ['cand_a', 'cand_b']);
  assert.equal(result.pairwise[0].delta, 0);
  assert.equal(result.pairwise[0].winner, 'cand_a');
  assert.match(result.pairwise[0].reason, /candidate id/);
});

test('prefers candidates with stronger replay self-validation and consistency', () => {
  const result = judgeSelfPreference({
    baseline: { validation: { score: 0.5 }, consistency: { score: 0.5 } },
    candidate: { validation: { score: 1 }, consistency: { score: 1 } },
  });

  assert.equal(result.preferred, 'candidate');
  assert.equal(result.baselineScore < result.candidateScore, true);
});
