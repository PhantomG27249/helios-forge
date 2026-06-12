import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  runModelCouncilPassKEval,
  summarizePassKUplift,
} from '../src/harness-sidecar/evals/modelCouncilPassK.js';

function suiteCases(count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `heldout-${index + 1}`,
    suiteId: 'suite-prod-1',
    prompt: `prompt must not leak ${index + 1}`,
  }));
}

function solvesFirst(limit) {
  return async ({ caseRecord, index }) => ({
    solved: index < limit,
    score: index < limit ? 1 : 0,
    modelProfile: caseRecord.modelProfile || 'model-a',
  });
}

test('production pass@k preserves held-out suite id and confidence intervals', async () => {
  const routerDefaults = { defaultModel: 'model-a', weights: { 'model-a': 1 } };
  const report = await runModelCouncilPassKEval({
    suiteId: 'suite-prod-1',
    cases: suiteCases(),
    k: 1,
    minCases: 10,
    modelRouter: {
      defaults: routerDefaults,
      state: {
        recordReward() {},
      },
    },
    variants: {
      bestSingle: solvesFirst(7),
      repeatedSampling: solvesFirst(7),
      staticCouncil: solvesFirst(8),
      adaptiveCouncil: solvesFirst(9),
      calibratedEnsemble: solvesFirst(10),
    },
  });

  assert.equal(report.suiteId, 'suite-prod-1');
  assert.equal(report.caseCount, 12);
  assert.equal(report.baselines.bestSingle.passAtK, 0.583333);
  assert.equal(report.baselines.repeatedSampling.passAtK, 0.583333);
  assert.equal(report.variants.staticCouncil.passAtK, 0.666667);
  assert.equal(report.variants.adaptiveCouncil.passAtK, 0.75);
  assert.equal(report.variants.calibratedEnsemble.passAtK, 0.833333);
  assert.equal(report.confidenceIntervals.calibratedEnsemble.lower >= 0, true);
  assert.equal(report.confidenceIntervals.calibratedEnsemble.upper <= 1, true);
  assert.deepEqual(report.regressions, []);
  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.canPromote, false);
  assert.equal(report.recommendedForPromotion, false);
  assert.deepEqual(routerDefaults, { defaultModel: 'model-a', weights: { 'model-a': 1 } });
  assert.equal(JSON.stringify(report).includes('prompt must not leak'), false);
});

test('production pass@k records minimum case and ensemble regressions as evidence only', async () => {
  const report = await runModelCouncilPassKEval({
    suiteId: 'suite-small',
    cases: suiteCases(4),
    k: 1,
    minCases: 10,
    variants: {
      bestSingle: solvesFirst(3),
      repeatedSampling: solvesFirst(3),
      staticCouncil: solvesFirst(3),
      adaptiveCouncil: solvesFirst(2),
      calibratedEnsemble: solvesFirst(1),
    },
  });

  assert.equal(report.confidence.minCasesMet, false);
  assert.equal(report.proven, false);
  assert.equal(report.regressions.some((item) => item.reason === 'minimum_case_count_not_met'), true);
  assert.equal(report.regressions.some((item) => item.reason === 'adaptive_below_best_single'), true);
  assert.equal(report.regressions.some((item) => item.reason === 'calibrated_below_static_council'), true);
  assert.equal(report.canPromote, false);
  assert.equal(report.recommendedForPromotion, false);
});

test('production pass@k is not proven when calibrated ensemble regresses at scale', async () => {
  const report = await runModelCouncilPassKEval({
    suiteId: 'suite-regression',
    cases: suiteCases(12),
    k: 1,
    minCases: 10,
    variants: {
      bestSingle: solvesFirst(8),
      repeatedSampling: solvesFirst(8),
      staticCouncil: solvesFirst(10),
      adaptiveCouncil: solvesFirst(10),
      calibratedEnsemble: solvesFirst(7),
    },
  });
  const summary = summarizePassKUplift(report);

  assert.equal(report.confidence.minCasesMet, true);
  assert.equal(report.confidence.upliftThresholdMet, true);
  assert.equal(report.regressions.some((item) => item.reason === 'calibrated_below_static_council'), true);
  assert.equal(report.proven, false);
  assert.equal(summary.calibratedEnsemblePassAtK, report.variants.calibratedEnsemble.passAtK);
  assert.deepEqual(summary.calibratedEnsembleConfidenceInterval, report.confidenceIntervals.calibratedEnsemble);
  assert.equal(summary.regressionCount, 1);
});
