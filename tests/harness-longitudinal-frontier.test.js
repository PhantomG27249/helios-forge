import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BENCHMARK_DIMENSIONS,
  appendLongitudinalFrontierCycle,
  createHeldOutBenchmarkSuite,
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
