import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runReplayCycle } from '../src/harness-sidecar/benchmarks/replayCycleRunner.js';

const fixedNow = () => new Date('2026-06-12T00:00:00.000Z');

test('aggregates baseline and candidate replay scores by held-out suite domain', async () => {
  const suite = {
    id: 'production-replay',
    domains: ['code', 'safety'],
    cases: [
      { id: 'case-code', domain: 'code', metricWeights: { quality: 1, reliability: 1 } },
      { id: 'case-safety', domain: 'safety', metricWeights: { safety: 2 } },
    ],
  };

  const report = await runReplayCycle({
    suite,
    candidates: [{ id: 'candidate-a' }, { id: 'candidate-b' }],
    baselineRunner: async ({ case: replayCase }) => ({
      passed: true,
      metrics: replayCase.domain === 'code'
        ? { quality: 0.5, reliability: 0.7 }
        : { safety: 0.8 },
      budget: { cost: 1, tokens: 10 },
    }),
    candidateRunner: async ({ candidate, case: replayCase }) => ({
      passed: true,
      metrics: candidate.id === 'candidate-a'
        ? (replayCase.domain === 'code'
          ? { quality: 0.8, reliability: 0.8 }
          : { safety: 0.9 })
        : (replayCase.domain === 'code'
          ? { quality: 0.4, reliability: 0.6 }
          : { safety: 0.7 }),
      budget: { cost: 2, tokens: 20 },
      rollbackDrill: { passed: true },
    }),
    budget: { maxCases: 10, maxCost: 20, maxCandidateRuns: 8 },
    now: fixedNow,
  });

  assert.equal(report.reportId, 'replay-cycle-production-replay-candidate-a-candidate-b-2026-06-12T00-00-00-000Z');
  assert.equal(report.suiteId, 'production-replay');
  assert.deepEqual(report.candidateIds, ['candidate-a', 'candidate-b']);
  assert.deepEqual(report.domainScores.code, {
    baselineScore: 0.6,
    bestCandidateId: 'candidate-a',
    bestCandidateScore: 0.8,
    delta: 0.2,
    caseCount: 1,
  });
  assert.deepEqual(report.domainScores.safety, {
    baselineScore: 0.8,
    bestCandidateId: 'candidate-a',
    bestCandidateScore: 0.9,
    delta: 0.1,
    caseCount: 1,
  });
  assert.equal(report.aggregateScore, 0.15);
  assert.deepEqual(report.regressions.map((regression) => regression.candidateId), ['candidate-b', 'candidate-b']);
  assert.equal(report.quarantineBlocks.length, 0);
  assert.equal(report.rollbackDrillRequired, false);
  assert.deepEqual(report.budget, {
    limits: { maxCases: 10, maxCost: 20, maxCandidateRuns: 8 },
    used: { baselineRuns: 2, candidateRuns: 4, casesEvaluated: 2, cost: 10, tokens: 100 },
    exceeded: false,
    exceededReasons: [],
  });
  assert.equal(report.promotionEvidenceOnly, true);
  assert.equal(report.canPromote, false);
  assert.equal(report.authority, 'evidence_only');
});

test('quarantine blocks unsafe suites cases candidates and runner evidence without applying changes', async () => {
  const calls = [];
  const report = await runReplayCycle({
    suite: {
      id: 'quarantine-replay',
      domains: ['code'],
      quarantine: { quarantined: true, reasons: ['operator_review'] },
      cases: [
        { id: 'safe-case', domain: 'code', metricWeights: { quality: 1 } },
        { id: 'blocked-case', domain: 'code', metricWeights: { quality: 1 }, quarantine: true },
      ],
    },
    candidates: [
      { id: 'candidate-safe' },
      { id: 'candidate-blocked', quarantine: { quarantined: true, reasons: ['unsafe_claim'] } },
    ],
    baselineRunner: async ({ case: replayCase }) => {
      calls.push(`baseline:${replayCase.id}`);
      return { passed: true, metrics: { quality: 0.5 }, budget: { cost: 1 } };
    },
    candidateRunner: async ({ candidate, case: replayCase }) => {
      calls.push(`candidate:${candidate.id}:${replayCase.id}`);
      return {
        passed: true,
        metrics: { quality: 0.9 },
        quarantine: { quarantined: true, reasons: ['secret_like_value'] },
        budget: { cost: 1 },
        canPromote: true,
        authority: 'apply',
      };
    },
    budget: { maxCases: 4, maxCost: 10 },
    now: fixedNow,
  });

  assert.deepEqual(calls, ['baseline:safe-case', 'candidate:candidate-safe:safe-case']);
  assert.deepEqual(
    report.quarantineBlocks.map((block) => `${block.scope}:${block.id}:${block.reason}`).sort(),
    [
      'candidate:candidate-blocked:unsafe_claim',
      'candidate_result:candidate-safe:secret_like_value',
      'case:blocked-case:quarantined',
      'suite:quarantine-replay:operator_review',
    ],
  );
  assert.equal(report.promotionEvidenceOnly, true);
  assert.equal(report.canPromote, false);
  assert.equal(report.authority, 'evidence_only');
  assert.equal(JSON.stringify(report).includes('"canPromote":true'), false);
  assert.equal(JSON.stringify(report).includes('"authority":"apply"'), false);
});

test('requires rollback drills for improved candidates without passing rollback evidence', async () => {
  const report = await runReplayCycle({
    suite: {
      id: 'rollback-replay',
      domains: ['code'],
      cases: [{ id: 'case-1', domain: 'code', metricWeights: { quality: 1 } }],
    },
    candidates: [{ id: 'candidate-without-drill' }],
    baselineRunner: async () => ({ passed: true, metrics: { quality: 0.5 } }),
    candidateRunner: async () => ({ passed: true, metrics: { quality: 0.9 } }),
    now: fixedNow,
  });

  assert.equal(report.aggregateScore, 0.4);
  assert.equal(report.rollbackDrillRequired, true);
  assert.deepEqual(report.regressions, []);
  assert.equal(report.canPromote, false);
});

test('accounts for budget pressure and marks exceeded replay budgets', async () => {
  const report = await runReplayCycle({
    suite: {
      id: 'budget-replay',
      domains: ['code'],
      cases: [
        { id: 'case-1', domain: 'code', metricWeights: { quality: 1 } },
        { id: 'case-2', domain: 'code', metricWeights: { quality: 1 } },
      ],
    },
    candidates: [{ id: 'candidate-a' }],
    baselineRunner: async () => ({ passed: true, metrics: { quality: 0.5 }, budget: { cost: 2, tokens: 4 } }),
    candidateRunner: async () => ({
      passed: true,
      metrics: { quality: 0.7 },
      budget: { cost: 3, tokens: 8 },
      rollbackDrill: { passed: true },
    }),
    budget: { maxCases: 1, maxCost: 4, maxCandidateRuns: 1 },
    now: fixedNow,
  });

  assert.deepEqual(report.budget.used, {
    baselineRuns: 2,
    candidateRuns: 2,
    casesEvaluated: 2,
    cost: 10,
    tokens: 24,
  });
  assert.equal(report.budget.exceeded, true);
  assert.deepEqual(report.budget.exceededReasons, ['maxCandidateRuns_exceeded', 'maxCases_exceeded', 'maxCost_exceeded']);
  assert.equal(report.canPromote, false);
});
