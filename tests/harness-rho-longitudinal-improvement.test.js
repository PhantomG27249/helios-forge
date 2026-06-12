import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  summarizeRhoImprovementTrends,
  updateRhoImprovementHistory,
} from '../src/harness-sidecar/rho/longitudinalImprovementTracker.js';

test('records promoted-candidate follow-up requirements without promotion authority', () => {
  const history = [];
  const next = updateRhoImprovementHistory({
    history,
    replayReport: {
      reportId: 'rho-report-001',
      suiteId: 'new-suite',
      candidateIds: ['candidate-alpha'],
      aggregateScore: 0.82,
      domainScores: { code: 0.82 },
      budget: { spentUsd: 1.25, maxUsd: 10, casesRun: 4, maxCases: 16 },
    },
    promotedCandidate: {
      candidateId: 'candidate-alpha',
      promotedAt: '2026-06-11T19:00:00.000Z',
      followUpSuites: ['old-suite', 'visual-holdout'],
    },
    now: () => new Date('2026-06-12T00:00:00.000Z'),
  });

  assert.equal(history.length, 0);
  assert.equal(next.length, 1);
  assert.equal(next[0].recordedAt, '2026-06-12T00:00:00.000Z');
  assert.equal(next[0].reportId, 'rho-report-001');
  assert.equal(next[0].candidateId, 'candidate-alpha');
  assert.equal(next[0].followUp.required, true);
  assert.deepEqual(next[0].followUp.suites, ['old-suite', 'visual-holdout']);
  assert.equal(next[0].followUp.reason, 'promoted_candidate_follow_up');
  assert.equal(next[0].authority, 'evidence_only');
  assert.equal(next[0].evidenceOnly, true);
  assert.equal(next[0].canPromote, false);
  assert.equal(next[0].promotionAllowed, false);
});

test('tracks regressions on old suites across repeated RHO reports', () => {
  const first = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-old-001',
      suiteId: 'old-suite',
      suiteAgeDays: 42,
      candidateIds: ['candidate-alpha'],
      aggregateScore: 0.81,
      domainScores: { code: 0.81 },
      budget: { spentUsd: 0.5, casesRun: 2 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  const second = updateRhoImprovementHistory({
    history: first,
    replayReport: {
      reportId: 'rho-old-002',
      suiteId: 'old-suite',
      suiteAgeDays: 43,
      candidateIds: ['candidate-alpha'],
      aggregateScore: 0.74,
      domainScores: { code: 0.74 },
      regressions: [
        { caseId: 'legacy-code-case', domain: 'code', metric: 'quality', previous: 0.81, current: 0.74 },
      ],
      budget: { spentUsd: 0.75, casesRun: 2 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  assert.equal(second[1].classification, 'regression');
  assert.equal(second[1].previousReportId, 'rho-old-001');
  assert.equal(second[1].oldSuite, true);
  assert.equal(second[1].oldSuiteRegressions.length, 1);
  assert.deepEqual(second[1].oldSuiteRegressions[0], {
    suiteId: 'old-suite',
    caseId: 'legacy-code-case',
    domain: 'code',
    metric: 'quality',
    previous: 0.81,
    current: 0.74,
    delta: -0.07,
    authority: 'evidence_only',
    canPromote: false,
  });
});

test('preserves replay-cycle regression score evidence for old suites', () => {
  const history = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-old-replay-regression',
      suiteId: 'legacy-replay-suite',
      suiteAgeDays: 60,
      candidateIds: ['candidate-alpha'],
      aggregateScore: 0.67,
      domainScores: { code: { baselineScore: 0.82, bestCandidateScore: 0.67, delta: -0.15 } },
      regressions: [
        {
          caseId: 'legacy-replay-case',
          domain: 'code',
          metric: 'quality',
          baselineScore: 0.82,
          candidateScore: 0.67,
          delta: -0.15,
          authority: 'trusted_apply',
          canPromote: true,
          apply: true,
        },
      ],
      budget: { casesRun: 1 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.deepEqual(history[0].oldSuiteRegressions[0], {
    suiteId: 'legacy-replay-suite',
    caseId: 'legacy-replay-case',
    domain: 'code',
    metric: 'quality',
    previous: 0.82,
    current: 0.67,
    delta: -0.15,
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(history[0].classification, 'regression');

  const summary = summarizeRhoImprovementTrends(history);
  assert.equal(summary.classificationCounts.regression, 1);
  assert.equal(summary.classificationCounts.new, 0);
  assert.equal(Object.hasOwn(history[0].oldSuiteRegressions[0], 'apply'), false);
});

test('captures domain-specific drift between longitudinal RHO reports', () => {
  const first = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-domain-001',
      suiteId: 'mixed-suite',
      candidateIds: ['candidate-beta'],
      aggregateScore: 0.75,
      domainScores: {
        code: { candidateScore: 0.8 },
        visual: { candidateScore: 0.7 },
      },
      budget: { casesRun: 4 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  const second = updateRhoImprovementHistory({
    history: first,
    replayReport: {
      reportId: 'rho-domain-002',
      suiteId: 'mixed-suite',
      candidateIds: ['candidate-beta'],
      aggregateScore: 0.705,
      domainScores: {
        code: { candidateScore: 0.84 },
        visual: { candidateScore: 0.55 },
      },
      budget: { casesRun: 4 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  assert.equal(second[1].domainDrift.code.classification, 'improvement');
  assert.equal(second[1].domainDrift.code.delta, 0.04);
  assert.equal(second[1].domainDrift.visual.classification, 'regression');
  assert.equal(second[1].domainDrift.visual.delta, -0.15);
  assert.equal(second[1].domainDrift.visual.previous, 0.7);
  assert.equal(second[1].domainDrift.visual.current, 0.55);
});

test('does not infer positive drift from missing historical domain scores', () => {
  const first = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-missing-domain-001',
      suiteId: 'missing-domain-suite',
      candidateIds: ['candidate-missing-domain'],
      aggregateScore: 0.9,
      domainScores: null,
      budget: { casesRun: 1 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  const second = updateRhoImprovementHistory({
    history: first,
    replayReport: {
      reportId: 'rho-missing-domain-002',
      suiteId: 'missing-domain-suite',
      candidateIds: ['candidate-missing-domain'],
      aggregateScore: 0.8,
      domainScores: { code: 0.8 },
      regressions: [
        { caseId: 'missing-domain-case', domain: 'code', baselineScore: 0.9, candidateScore: 0.8, delta: -0.1 },
      ],
      budget: { casesRun: 1 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  assert.deepEqual(second[1].domainDrift, {});
  assert.equal(second[1].classification, 'regression');

  const summary = summarizeRhoImprovementTrends(second);
  assert.equal(summary.classificationCounts.regression, 1);
  assert.equal(summary.classificationCounts.mixed, 0);
});

test('normalizes budget accounting for longitudinal RHO reports', () => {
  const history = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-budget-001',
      suiteId: 'budget-suite',
      candidateIds: ['candidate-budget'],
      aggregateScore: 0.66,
      domainScores: { tool: 0.66 },
      budget: {
        spentUsd: 1.234,
        maxUsd: 4,
        casesRun: 9,
        maxCases: 12,
        tokensUsed: 1200,
        maxTokens: 2000,
        blockedJobCount: 2,
      },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.deepEqual(history[0].budget, {
    spentUsd: 1.23,
    maxUsd: 4,
    remainingUsd: 2.77,
    percentUsdUsed: 30.85,
    casesRun: 9,
    maxCases: 12,
    percentCasesUsed: 75,
    tokensUsed: 1200,
    maxTokens: 2000,
    percentTokensUsed: 60,
    blockedJobCount: 2,
  });

  const summary = summarizeRhoImprovementTrends(history);
  assert.equal(summary.budget.spentUsd, 1.23);
  assert.equal(summary.budget.casesRun, 9);
  assert.equal(summary.budget.blockedJobCount, 2);
});

test('normalizes real replay-cycle domain score objects', () => {
  const first = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-replay-cycle-001',
      suiteId: 'replay-cycle-suite',
      candidateIds: ['candidate-replay'],
      aggregateScore: 0.745,
      domainScores: {
        code: { baselineScore: 0.7, bestCandidateScore: 0.88, delta: 0.18 },
        visual: { baselineScore: 0.6, bestCandidateScore: 0.61, delta: 0.01 },
      },
      budget: { casesRun: 4 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  const second = updateRhoImprovementHistory({
    history: first,
    replayReport: {
      reportId: 'rho-replay-cycle-002',
      suiteId: 'replay-cycle-suite',
      candidateIds: ['candidate-replay'],
      aggregateScore: 0.695,
      domainScores: {
        code: { baselineScore: 0.7, bestCandidateScore: 0.8, delta: 0.1 },
        visual: { baselineScore: 0.6, bestCandidateScore: 0.59, delta: -0.01 },
      },
      budget: { casesRun: 4 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  assert.deepEqual(first[0].domainScores, { code: 0.88, visual: 0.61 });
  assert.equal(second[1].domainDrift.code.previous, 0.88);
  assert.equal(second[1].domainDrift.code.current, 0.8);
  assert.equal(second[1].domainDrift.code.delta, -0.08);
  assert.equal(second[1].domainDrift.visual.previous, 0.61);
  assert.equal(second[1].domainDrift.visual.current, 0.59);
  assert.equal(second[1].domainDrift.visual.delta, -0.02);
});

test('normalizes real replay-cycle nested budget accounting', () => {
  const history = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-nested-budget-001',
      suiteId: 'nested-budget-suite',
      candidateIds: ['candidate-budget'],
      aggregateScore: 0.66,
      domainScores: { code: 0.66 },
      budget: {
        used: {
          cost: 2.345,
          tokens: 3456,
          casesEvaluated: 7,
        },
        limits: {
          cost: 10,
          tokens: 10000,
          casesEvaluated: 20,
        },
        blockedJobCount: 1,
      },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.deepEqual(history[0].budget, {
    spentUsd: 2.35,
    maxUsd: 10,
    remainingUsd: 7.65,
    percentUsdUsed: 23.45,
    casesRun: 7,
    maxCases: 20,
    percentCasesUsed: 35,
    tokensUsed: 3456,
    maxTokens: 10000,
    percentTokensUsed: 34.56,
    blockedJobCount: 1,
  });
});

test('normalizes replay-cycle max budget limits', () => {
  const history = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-replay-budget-limits-001',
      suiteId: 'replay-budget-limits-suite',
      candidateIds: ['candidate-budget-limits'],
      aggregateScore: 0.71,
      domainScores: { code: 0.71 },
      budget: {
        used: { cost: 10, tokens: 100, casesEvaluated: 2 },
        limits: { maxCost: 20, maxTokens: 200, maxCases: 4 },
      },
    },
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.deepEqual(history[0].budget, {
    spentUsd: 10,
    maxUsd: 20,
    remainingUsd: 10,
    percentUsdUsed: 50,
    casesRun: 2,
    maxCases: 4,
    percentCasesUsed: 50,
    tokensUsed: 100,
    maxTokens: 200,
    percentTokensUsed: 50,
    blockedJobCount: 0,
  });
});

test('sanitizes historical old-suite regressions back to evidence-only records', () => {
  const history = updateRhoImprovementHistory({
    history: [
      {
        recordedAt: '2026-06-12T00:00:00.000Z',
        reportId: 'rho-unsafe-history',
        suiteId: 'legacy-suite',
        candidateId: 'candidate-unsafe',
        aggregateScore: 0.62,
        domainScores: { code: 0.62 },
        oldSuite: true,
        oldSuiteRegressions: [
          {
            suiteId: 'legacy-suite',
            caseId: 'legacy-case',
            domain: 'code',
            metric: 'quality',
            previous: 0.82,
            current: 0.62,
            authority: 'trusted_apply',
            canPromote: true,
            apply: true,
          },
        ],
      },
    ],
    replayReport: {
      reportId: 'rho-safe-next',
      suiteId: 'legacy-suite',
      candidateIds: ['candidate-unsafe'],
      aggregateScore: 0.64,
      domainScores: { code: 0.64 },
      budget: { casesRun: 1 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  assert.deepEqual(history[0].oldSuiteRegressions[0], {
    suiteId: 'legacy-suite',
    caseId: 'legacy-case',
    domain: 'code',
    metric: 'quality',
    previous: 0.82,
    current: 0.62,
    delta: -0.2,
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(Object.hasOwn(history[0].oldSuiteRegressions[0], 'apply'), false);
});

test('sanitizes historical domain drift before dashboard exposure', () => {
  const summary = summarizeRhoImprovementTrends([
    {
      recordedAt: '2026-06-12T00:00:00.000Z',
      reportId: 'rho-unsafe-drift',
      suiteId: 'drift-suite',
      candidateId: 'candidate-drift',
      aggregateScore: 0.62,
      domainScores: { code: 0.62 },
      domainDrift: {
        code: {
          previous: 0.82,
          current: 0.62,
          delta: -0.2,
          classification: 'regression',
          authority: 'trusted_apply',
          canPromote: true,
          apply: true,
          promote: true,
          verified: true,
        },
      },
    },
  ]);

  assert.deepEqual(summary.dashboardRows[0].domainDrift.code, {
    previous: 0.82,
    current: 0.62,
    delta: -0.2,
    classification: 'regression',
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(Object.hasOwn(summary.dashboardRows[0].domainDrift.code, 'apply'), false);
  assert.equal(Object.hasOwn(summary.dashboardRows[0].domainDrift.code, 'promote'), false);
  assert.equal(Object.hasOwn(summary.dashboardRows[0].domainDrift.code, 'verified'), false);
});

test('normalizes nullable persisted fields as empty evidence', () => {
  const summary = summarizeRhoImprovementTrends([
    {
      recordedAt: '2026-06-12T00:00:00.000Z',
      reportId: 'rho-null-persisted-fields',
      suiteId: 'nullable-suite',
      candidateId: 'candidate-nullable',
      aggregateScore: 0.5,
      domainScores: null,
      domainDrift: null,
      oldSuite: true,
      oldSuiteRegressions: [null],
      budget: null,
    },
  ]);

  assert.deepEqual(summary.dashboardRows[0].domainScores, {});
  assert.deepEqual(summary.dashboardRows[0].domainDrift, {});
  assert.equal(summary.dashboardRows[0].oldSuiteRegressionCount, 0);
  assert.equal(summary.dashboardRows[0].canPromote, false);
  assert.equal(summary.dashboardRows[0].authority, 'evidence_only');
});

test('canonicalizes persisted classification before dashboard exposure', () => {
  const summary = summarizeRhoImprovementTrends([
    {
      recordedAt: '2026-06-12T00:00:00.000Z',
      reportId: 'rho-unsafe-classification',
      suiteId: 'classification-suite',
      candidateId: 'candidate-classification',
      aggregateScore: 0.5,
      aggregateDelta: null,
      classification: 'trusted_apply',
      domainScores: { code: 0.5 },
    },
  ]);

  assert.equal(summary.dashboardRows[0].classification, 'new');
  assert.equal(summary.classificationCounts.new, 1);
  assert.equal(Object.hasOwn(summary.classificationCounts, 'trusted_apply'), false);
});

test('skips null persisted history tombstones', () => {
  const summary = summarizeRhoImprovementTrends([null]);

  assert.equal(summary.recordCount, 0);
  assert.deepEqual(summary.dashboardRows, []);
  assert.deepEqual(summary.classificationCounts, {
    improvement: 0,
    mixed: 0,
    new: 0,
    regression: 0,
    unchanged: 0,
  });
});

test('summarizes dashboard-ready RHO trend rows', () => {
  const first = updateRhoImprovementHistory({
    replayReport: {
      reportId: 'rho-trend-001',
      suiteId: 'trend-suite',
      candidateIds: ['candidate-gamma'],
      aggregateScore: 0.7,
      domainScores: { code: 0.7, memory: 0.74 },
      budget: { spentUsd: 1, maxUsd: 5, casesRun: 3, maxCases: 10 },
    },
    now: '2026-06-12T00:00:00.000Z',
  });
  const second = updateRhoImprovementHistory({
    history: first,
    replayReport: {
      reportId: 'rho-trend-002',
      suiteId: 'trend-suite',
      candidateIds: ['candidate-gamma'],
      aggregateScore: 0.78,
      domainScores: { code: 0.82, memory: 0.76 },
      budget: { spentUsd: 1.5, maxUsd: 5, casesRun: 4, maxCases: 10 },
    },
    now: '2026-06-13T00:00:00.000Z',
  });

  const summary = summarizeRhoImprovementTrends(second);

  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.authority, 'evidence_only');
  assert.equal(summary.evidenceOnly, true);
  assert.equal(summary.canPromote, false);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.classificationCounts.new, 1);
  assert.equal(summary.classificationCounts.improvement, 1);
  assert.deepEqual(summary.dashboardRows.map((row) => [
    row.reportId,
    row.suiteId,
    row.candidateId,
    row.classification,
    row.aggregateScore,
    row.aggregateDelta,
    row.canPromote,
  ]), [
    ['rho-trend-001', 'trend-suite', 'candidate-gamma', 'new', 0.7, null, false],
    ['rho-trend-002', 'trend-suite', 'candidate-gamma', 'improvement', 0.78, 0.08, false],
  ]);
  assert.deepEqual(summary.dashboardRows[1].domainDrift.code, {
    previous: 0.7,
    current: 0.82,
    delta: 0.12,
    classification: 'improvement',
  });
});
