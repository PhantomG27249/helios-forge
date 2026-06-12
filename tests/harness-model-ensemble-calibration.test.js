import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calibrateModelEnsemble } from '../src/harness-sidecar/model/ensembleCalibration.js';

const outcomes = [
  { caseId: 'case-1', modelProfile: 'model-a', solved: true, score: 1 },
  { caseId: 'case-2', modelProfile: 'model-a', solved: true, score: 0.9 },
  { caseId: 'case-3', modelProfile: 'model-a', solved: false, score: 0.2 },
  { caseId: 'case-1', modelProfile: 'model-b', solved: true, score: 0.8 },
  { caseId: 'case-2', modelProfile: 'model-b', solved: false, score: 0.2 },
  { caseId: 'case-3', modelProfile: 'model-b', solved: false, score: 0.1 },
];

test('ensemble calibration emits advisory model weights confidence intervals and no promotion', () => {
  const routerDefaults = { defaultModel: 'model-a', weights: { 'model-a': 1 } };
  const result = calibrateModelEnsemble({
    calibrationId: 'cal-prod-1',
    suiteId: 'suite-prod-1',
    outcomes,
    minCases: 3,
    routerDefaults,
  });

  assert.equal(result.calibrationId, 'cal-prod-1');
  assert.equal(result.suiteId, 'suite-prod-1');
  assert.equal(result.modelWeights['model-a'] > result.modelWeights['model-b'], true);
  assert.equal(result.confidenceIntervals['model-a'].lower >= 0, true);
  assert.equal(result.confidenceIntervals['model-a'].upper <= 1, true);
  assert.deepEqual(result.regressions, []);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.recommendedForPromotion, false);
  assert.deepEqual(routerDefaults, { defaultModel: 'model-a', weights: { 'model-a': 1 } });
});

test('ensemble calibration records minimum count and regression evidence', () => {
  const result = calibrateModelEnsemble({
    calibrationId: 'cal-small',
    suiteId: 'suite-small',
    outcomes: [
      { caseId: 'case-1', modelProfile: 'model-a', solved: false, score: 0.1 },
      { caseId: 'case-1', modelProfile: 'model-b', solved: true, score: 0.9 },
    ],
    minCases: 3,
    baselineWeights: { 'model-a': 1 },
  });

  assert.equal(result.modelWeights['model-a'] < result.modelWeights['model-b'], true);
  assert.equal(result.regressions.some((item) => item.reason === 'minimum_case_count_not_met'), true);
  assert.equal(result.regressions.some((item) => item.reason === 'baseline_model_weight_regressed'), true);
  assert.equal(JSON.stringify(result).includes('prompt'), false);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.recommendedForPromotion, false);
});

test('ensemble calibration redacts secret-shaped identifiers and router defaults', () => {
  const result = calibrateModelEnsemble({
    calibrationId: 'cal-sk-router-secret',
    suiteId: 'suite-prod?api_key=sk-suite',
    outcomes: [
      { caseId: 'case-1', modelProfile: 'sk-model-secret', solved: true },
      { caseId: 'case-2', endpointProfile: 'https://router.example.test/model?token=secret', solved: false },
    ],
    routerDefaults: {
      defaultModel: 'sk-model-secret',
      baseUrl: 'https://router.example.test/v1?token=secret',
      apiKey: 'sk-router-secret',
      weights: { 'sk-model-secret': 1 },
    },
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('sk-router-secret'), false);
  assert.equal(serialized.includes('sk-suite'), false);
  assert.equal(serialized.includes('sk-model-secret'), false);
  assert.equal(serialized.includes('token=secret'), false);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.recommendedForPromotion, false);
});
