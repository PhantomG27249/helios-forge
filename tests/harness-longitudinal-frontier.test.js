import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BENCHMARK_DIMENSIONS,
  appendLongitudinalFrontierCycle,
  createHeldOutBenchmarkSuite,
  summarizeLongitudinalFrontier,
} from '../src/harness-sidecar/meta/longitudinalFrontier.js';

test('creates a locked held-out benchmark suite over the paper-grade dimensions', () => {
  const suite = createHeldOutBenchmarkSuite({
    suiteId: 'paper-grade-holdout',
    description: 'Stable regression suite for repeated meta-harness cycles.',
    cases: [
      { caseId: 'quality-hard-case', tags: ['quality'] },
      { caseId: 'trust-risk-case', tags: ['trust'] },
    ],
  });

  assert.equal(suite.schemaVersion, 1);
  assert.equal(suite.suiteId, 'paper-grade-holdout');
  assert.equal(suite.locked, true);
  assert.equal(suite.authority, 'benchmark_evidence_only');
  assert.equal(suite.canPromote, false);
  assert.deepEqual(suite.dimensions, BENCHMARK_DIMENSIONS);
  assert.deepEqual(suite.cases.map((entry) => entry.caseId), [
    'quality-hard-case',
    'trust-risk-case',
  ]);
});

test('records repeated benchmark cycles and keeps advisory frontier history across all dimensions', () => {
  const suite = createHeldOutBenchmarkSuite({
    suiteId: 'meta-harness-holdout',
    cases: [{ caseId: 'fixed-case-a' }],
  });

  const first = appendLongitudinalFrontierCycle({
    suite,
    cycleId: 'cycle_001',
    results: [
      {
        candidateId: 'baseline',
        metrics: {
          quality: 0.7,
          safety: 0.9,
          reliability: 0.8,
          cost: 0.4,
          latency: 10,
          maintainability: 0.7,
          visualConfidence: 0.6,
          memoryHealth: 0.75,
          trustRisk: 0.2,
        },
      },
    ],
  });

  const second = appendLongitudinalFrontierCycle({
    history: first,
    suite,
    cycleId: 'cycle_002',
    results: [
      {
        candidateId: 'candidate-a',
        metrics: {
          quality: 0.76,
          safety: 0.92,
          reliability: 0.84,
          cost: 0.36,
          latency: 8,
          maintainability: 0.73,
          visualConfidence: 0.72,
          memoryHealth: 0.8,
          trustRisk: 0.15,
        },
        source: { lane: 'visual-memory-worker' },
      },
      {
        candidateId: 'candidate-risky-fast',
        metrics: {
          quality: 0.78,
          safety: 0.86,
          reliability: 0.7,
          cost: 0.2,
          latency: 5,
          maintainability: 0.5,
          visualConfidence: 0.7,
          memoryHealth: 0.6,
          trustRisk: 0.45,
        },
      },
    ],
  });

  assert.equal(second.schemaVersion, 1);
  assert.equal(second.authority, 'advisory');
  assert.equal(second.canPromote, false);
  assert.deepEqual(second.cycles.map((cycle) => cycle.cycleId), ['cycle_001', 'cycle_002']);
  assert.equal(second.cycles[1].suiteId, 'meta-harness-holdout');
  assert.deepEqual(second.cycles[1].entries[0].dimensions, BENCHMARK_DIMENSIONS);
  assert.equal(second.cycles[1].entries[0].metrics.visualConfidence, 0.72);
  assert.equal(second.cycles[1].entries[0].metrics.memoryHealth, 0.8);
  assert.equal(second.cycles[1].entries[0].metrics.trustRisk, 0.15);
  assert.equal(second.cycles[1].entries[0].canPromote, false);
  assert.deepEqual(second.frontier.map((entry) => entry.candidateId), [
    'candidate-a',
    'candidate-risky-fast',
  ]);
});

test('sanitizes lane-fed benchmark results without granting promotion authority', () => {
  const suite = createHeldOutBenchmarkSuite({
    suiteId: 'lane-fed-suite',
    cases: [{ caseId: 'case one' }],
  });

  const history = appendLongitudinalFrontierCycle({
    suite,
    cycleId: 'cycle-lane-feed',
    results: [
      {
        candidateId: 'lane candidate 1',
        promotionDecision: { status: 'promoted' },
        canPromote: true,
        metrics: {
          quality: 0.5,
          safety: 0.5,
          reliability: 0.5,
          cost: 1,
          latency: 1,
          maintainability: 0.5,
          visualConfidence: 0.5,
          memoryHealth: 0.5,
          trustRisk: 0.5,
        },
      },
    ],
  });

  assert.equal(history.cycles[0].entries[0].candidateId, 'lane_candidate_1_e8369ab3');
  assert.equal(history.cycles[0].entries[0].promotionDecision, null);
  assert.equal(history.cycles[0].entries[0].authority, 'benchmark_evidence_only');
  assert.equal(history.cycles[0].entries[0].canPromote, false);
  assert.equal(history.frontier[0].canPromote, false);
});

test('compares repeated suite cycles with classifications accounting and dashboard rows', () => {
  const suite = createHeldOutBenchmarkSuite({
    suiteId: 'stable-longitudinal-holdout',
    cases: [{ caseId: 'quality-safety-fixed' }, { caseId: 'memory-trust-fixed' }],
  });

  const first = appendLongitudinalFrontierCycle({
    suite,
    cycleId: 'cycle-001',
    recordedAt: '2026-06-09T20:00:00.000Z',
    budget: { spentUsd: 1.2, remainingUsd: 8.8, maxUsd: 10 },
    results: [
      {
        candidateId: 'champion',
        metrics: {
          quality: 0.72,
          safety: 0.9,
          reliability: 0.8,
          cost: 0.4,
          latency: 12,
          maintainability: 0.7,
          visualConfidence: 0.64,
          memoryHealth: 0.74,
          trustRisk: 0.22,
        },
      },
    ],
  });

  const second = appendLongitudinalFrontierCycle({
    history: first,
    suite,
    cycleId: 'cycle-002',
    recordedAt: '2026-06-09T21:00:00.000Z',
    budget: { spentUsd: 1.6, remainingUsd: 7.2, maxUsd: 10, blockedJobCount: 1 },
    results: [
      {
        candidateId: 'champion',
        metrics: {
          quality: 0.78,
          safety: 0.92,
          reliability: 0.84,
          cost: 0.34,
          latency: 10,
          maintainability: 0.76,
          visualConfidence: 0.72,
          memoryHealth: 0.81,
          trustRisk: 0.16,
        },
      },
      {
        candidateId: 'risky-fast',
        metrics: {
          quality: 0.8,
          safety: 0.84,
          reliability: 0.7,
          cost: 0.2,
          latency: 7,
          maintainability: 0.58,
          visualConfidence: 0.76,
          memoryHealth: 0.66,
          trustRisk: 0.42,
        },
      },
    ],
  });

  assert.equal(second.cycles[1].accounting.spentUsd, 1.6);
  assert.equal(second.cycles[1].accounting.remainingUsd, 7.2);
  assert.equal(second.cycles[1].accounting.caseCount, 2);
  assert.equal(second.cycles[1].accounting.entryCount, 2);
  assert.equal(second.cycles[1].entries[0].comparison.classification, 'improvement');
  assert.equal(second.cycles[1].entries[0].comparison.previousCycleId, 'cycle-001');
  assert.equal(second.cycles[1].entries[0].comparison.dimensionDeltas.quality.directionalDelta, 0.06);
  assert.equal(second.cycles[1].entries[0].comparison.dimensionDeltas.cost.directionalDelta, 0.06);
  assert.equal(second.cycles[1].entries[1].comparison.classification, 'regression');
  assert.equal(second.cycles[1].entries[1].comparison.previousCandidateId, 'champion');
  assert.equal(second.cycles[1].entries[1].canPromote, false);

  const summary = summarizeLongitudinalFrontier(second);
  assert.equal(summary.suiteCount, 1);
  assert.equal(summary.cycleCount, 2);
  assert.equal(summary.frontierCount, 2);
  assert.deepEqual(summary.classificationCounts, {
    improvement: 1,
    mixed: 0,
    new: 1,
    regression: 1,
    unchanged: 0,
  });
  assert.equal(summary.accounting.spentUsd, 2.8);
  assert.equal(summary.accounting.blockedJobCount, 1);
  assert.deepEqual(summary.dashboardRows.map((row) => [
    row.suiteId,
    row.cycleId,
    row.candidateId,
    row.classification,
    row.frontierMember,
    row.canPromote,
  ]), [
    ['stable-longitudinal-holdout', 'cycle-001', 'champion', 'new', true, false],
    ['stable-longitudinal-holdout', 'cycle-002', 'champion', 'improvement', true, false],
    ['stable-longitudinal-holdout', 'cycle-002', 'risky-fast', 'regression', true, false],
  ]);
});
