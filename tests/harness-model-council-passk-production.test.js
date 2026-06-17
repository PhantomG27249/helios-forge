import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProductionPassKReport,
  runModelCouncilPassKEval,
} from '../src/harness-sidecar/evals/modelCouncilPassK.js';
import { calibrateModelEnsemble } from '../src/harness-sidecar/model/ensembleCalibration.js';

function suiteCases(count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `heldout-${index + 1}`,
    suiteId: 'suite-prod-1',
    prompt: `prompt must not leak ${index + 1}`,
  }));
}

function solvesFirst(limit) {
  return async ({ index }) => ({
    solved: index < limit,
    score: index < limit ? 1 : 0,
    modelProfile: 'model-a',
  });
}

test('buildProductionPassKReport emits ensemble calibration evidence envelope', async () => {
  const report = await runModelCouncilPassKEval({
    suiteId: 'suite-prod-1',
    cases: suiteCases(),
    k: 1,
    minCases: 10,
    variants: {
      bestSingle: solvesFirst(7),
      repeatedSampling: solvesFirst(7),
      staticCouncil: solvesFirst(8),
      adaptiveCouncil: solvesFirst(9),
      calibratedEnsemble: solvesFirst(10),
    },
  });

  const production = buildProductionPassKReport({
    report,
    gate: { enabled: true, mode: 'advisory' },
    calibration: calibrateModelEnsemble({
      calibrationId: 'cal-prod-1',
      suiteId: 'suite-prod-1',
      outcomes: suiteCases().map((caseRecord, index) => ({
        caseId: caseRecord.caseId,
        modelProfile: index < 10 ? 'model-a' : 'model-b',
        solved: index < 10,
      })),
      minCases: 10,
    }),
  });

  assert.equal(production.evidenceType, 'modelCouncilCalibration');
  assert.equal(production.gateName, 'ensembleCalibration');
  assert.equal(production.evidenceOnly, true);
  assert.equal(production.canPromote, false);
  assert.equal(production.promotionEvidenceOnly, true);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.gate.name, 'ensembleCalibration');
  assert.equal(production.gate.enabled, true);
  assert.equal(production.gate.mode, 'advisory');
  assert.equal(production.gate.authority, 'evidence_only');
  assert.equal(production.summary.suiteId, 'suite-prod-1');
  assert.equal(production.summary.calibratedEnsemblePassAtK, 0.833333);
  assert.equal(production.summary.proven, true);
  assert.equal(production.passKReport.suiteId, 'suite-prod-1');
  assert.equal(production.passKReport.canPromote, false);
  assert.equal(production.passKReport.authority, 'evidence_only');
  assert.equal(production.calibration.evidenceOnly, true);
  assert.equal(production.calibration.canPromote, false);
  assert.equal(JSON.stringify(production).includes('prompt must not leak'), false);
});

test('buildProductionPassKReport records regressions and forces evidence-only on nested payloads', async () => {
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
  report.canPromote = true;
  report.authority = 'self_authorized';
  report.recommendedForPromotion = true;

  const production = buildProductionPassKReport({
    report,
    gate: { enabled: false, mode: 'offline' },
  });

  assert.equal(production.gate.enabled, false);
  assert.equal(production.summary.proven, false);
  assert.equal(production.summary.regressionCount >= 3, true);
  assert.equal(production.canPromote, false);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.passKReport.canPromote, false);
  assert.equal(production.passKReport.authority, 'evidence_only');
  assert.equal(production.passKReport.recommendedForPromotion, false);
  assert.equal(production.calibration, null);
});
