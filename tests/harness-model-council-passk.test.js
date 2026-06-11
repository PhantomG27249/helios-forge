import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  estimatePassAtK,
  runModelCouncilPassKEval,
  summarizePassKUplift,
} from '../src/harness-sidecar/evals/modelCouncilPassK.js';

function makeCases(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `case-${index + 1}`,
    prompt: `Solve deterministic case ${index + 1}`,
  }));
}

function solvesFirst(limit) {
  return async ({ caseRecord }) => ({
    solved: Number(caseRecord.caseId.replace('case-', '')) <= limit,
    score: Number(caseRecord.caseId.replace('case-', '')) <= limit ? 1 : 0,
  });
}

test('pass@k estimate is deterministic and bounded', () => {
  assert.equal(estimatePassAtK({ solvedCount: 6, totalCount: 10, k: 1 }), 0.6);
  assert.equal(estimatePassAtK({ solvedCount: 12, totalCount: 10, k: 1 }), 1);
  assert.equal(estimatePassAtK({ solvedCount: -2, totalCount: 10, k: 1 }), 0);
  assert.equal(estimatePassAtK({ solvedCount: 4, totalCount: 0, k: 1 }), 0);
});

test('model council pass@k eval proves adaptive uplift without promotion authority', async () => {
  const rewardUpdates = [];
  const report = await runModelCouncilPassKEval({
    cases: makeCases(),
    k: 1,
    modelRouter: {
      state: {
        recordReward(update) {
          rewardUpdates.push(update);
        },
      },
    },
    variants: {
      bestSingle: solvesFirst(6),
      repeatedSampling: solvesFirst(6),
      staticCouncil: solvesFirst(7),
      adaptiveCouncil: solvesFirst(8),
    },
  });

  assert.equal(report.baselines.bestSingle.passAtK, 0.6);
  assert.equal(report.baselines.repeatedSampling.passAtK, 0.6);
  assert.equal(report.variants.staticCouncil.passAtK, 0.7);
  assert.equal(report.variants.adaptiveCouncil.passAtK, 0.8);
  assert.equal(report.uplift.adaptiveVsBestSingle.delta, 0.2);
  assert.equal(report.uplift.staticVsBestSingle.delta, 0.1);
  assert.equal(report.uplift.adaptiveVsStatic.delta, 0.1);
  assert.equal(report.proven, true);
  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.canPromote, false);
  assert.equal(rewardUpdates.length, 10);
  assert.equal(JSON.stringify(report).includes('Solve deterministic case'), false);
});

test('pass@k uplift summary preserves the evidence-only boundary', async () => {
  const report = await runModelCouncilPassKEval({
    cases: makeCases(),
    variants: {
      bestSingle: solvesFirst(6),
      repeatedSampling: solvesFirst(6),
      staticCouncil: solvesFirst(7),
      adaptiveCouncil: solvesFirst(8),
    },
  });

  const summary = summarizePassKUplift(report);

  assert.equal(summary.bestSinglePassAtK, 0.6);
  assert.equal(summary.repeatedSamplingPassAtK, 0.6);
  assert.equal(summary.staticCouncilPassAtK, 0.7);
  assert.equal(summary.adaptiveCouncilPassAtK, 0.8);
  assert.equal(summary.uplift.adaptiveVsBestSingle.delta, 0.2);
  assert.equal(summary.proven, true);
  assert.equal(summary.authority, 'evidence_only');
  assert.equal(summary.canPromote, false);
});
