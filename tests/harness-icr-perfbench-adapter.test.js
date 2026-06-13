import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createIcrPerfBenchBranchHypotheses,
  createIcrPerfBenchReplayCase,
  createIcrPerfBenchTask,
  evaluateIcrPerfBenchCandidate,
} from '../src/harness-sidecar/icr/icrPerfBenchAdapter.js';

const BASE_TASK = {
  taskId: 'perf_two_sum_batch',
  title: 'Batch two-sum lookup',
  prompt: 'Optimize the batch lookup while preserving exact pair indices.',
  language: 'javascript',
  baselineImplementation: {
    entrypoint: 'solve',
    code: 'export function solve(items, target) { return items.map((row) => slowTwoSum(row, target)); }',
    complexity: 'O(batch * n^2)',
  },
  correctnessCheck: {
    kind: 'unit_tests',
    command: 'node --test perf-two-sum.test.js',
    cases: [
      { name: 'small_pairs' },
      { name: 'duplicates' },
      { name: 'negative_values' },
    ],
  },
  runtimeScore: {
    kind: 'relative_runtime',
    baselineMs: 1200,
    lowerIsBetter: true,
    metric: 'median_ms',
  },
  referenceOptimized: {
    implementationId: 'hashmap_reference',
    metadata: {
      approach: 'hash_map_lookup',
      complexity: 'O(batch * n)',
      referenceMs: 160,
    },
  },
  bottlenecks: [
    {
      id: 'nested_scan',
      summary: 'Nested scan repeats pair search for every row.',
      target: 'replace inner search with indexed lookup',
      expectedImpact: 'high',
    },
    {
      id: 'allocation_churn',
      summary: 'Temporary arrays are allocated inside the hot loop.',
      target: 'reuse compact lookup structures',
      expectedImpact: 'medium',
    },
  ],
};

test('describes inline PerfCodeBench-style tasks without external benchmark dependencies', () => {
  const task = createIcrPerfBenchTask(BASE_TASK);

  assert.equal(task.kind, 'icr_perfbench_task');
  assert.equal(task.lane, 'icr');
  assert.equal(task.taskId, 'perf_two_sum_batch');
  assert.equal(task.evidenceOnly, true);
  assert.equal(task.promotionAllowed, false);
  assert.equal(task.externalBenchmarkDependency, false);
  assert.equal(task.source, 'inline_perfcodebench_style');

  assert.deepEqual(task.baselineImplementation, {
    language: 'javascript',
    entrypoint: 'solve',
    code: BASE_TASK.baselineImplementation.code,
    complexity: 'O(batch * n^2)',
  });
  assert.deepEqual(task.correctnessCheck, {
    kind: 'unit_tests',
    command: 'node --test perf-two-sum.test.js',
    caseCount: 3,
    cases: BASE_TASK.correctnessCheck.cases,
  });
  assert.deepEqual(task.runtimeScore, {
    kind: 'relative_runtime',
    metric: 'median_ms',
    baselineMs: 1200,
    lowerIsBetter: true,
  });
  assert.deepEqual(task.referenceOptimized, {
    implementationId: 'hashmap_reference',
    metadata: BASE_TASK.referenceOptimized.metadata,
  });
});

test('reports correctness and runtime-efficiency scores as separate evidence fields', () => {
  const task = createIcrPerfBenchTask(BASE_TASK);

  const evaluation = evaluateIcrPerfBenchCandidate({
    task,
    candidate: {
      candidateId: 'candidate_hashmap',
      branchId: 'branch_nested_scan',
      implementation: 'export function solve(items, target) { /* optimized */ }',
    },
    correctnessResult: {
      passed: true,
      passedCount: 3,
      totalCount: 3,
    },
    runtimeResult: {
      candidateMs: 240,
      samples: [242, 238, 240],
    },
  });

  assert.equal(evaluation.kind, 'icr_perfbench_evaluation');
  assert.equal(evaluation.taskId, 'perf_two_sum_batch');
  assert.equal(evaluation.candidateId, 'candidate_hashmap');
  assert.equal(evaluation.evidenceOnly, true);
  assert.equal(evaluation.promotionAllowed, false);
  assert.deepEqual(evaluation.correctness, {
    passed: true,
    passedCount: 3,
    totalCount: 3,
    passRate: 1,
    failures: [],
  });
  assert.deepEqual(evaluation.runtimeEfficiency, {
    metric: 'median_ms',
    baselineMs: 1200,
    candidateMs: 240,
    referenceMs: 160,
    speedupVsBaseline: 5,
    efficiencyVsReference: 0.666667,
    score: 0.8,
    samples: [242, 238, 240],
  });
  assert.equal(Object.hasOwn(evaluation, 'correctnessAndRuntimeCombined'), false);
});

test('keeps runtime evidence visible when correctness fails', () => {
  const task = createIcrPerfBenchTask(BASE_TASK);

  const evaluation = evaluateIcrPerfBenchCandidate({
    task,
    candidate: { candidateId: 'candidate_fast_wrong' },
    correctnessResult: {
      passed: false,
      passedCount: 2,
      totalCount: 3,
      failures: ['negative_values'],
    },
    runtimeResult: {
      candidateMs: 120,
    },
  });

  assert.equal(evaluation.correctness.passed, false);
  assert.equal(evaluation.correctness.passRate, 0.666667);
  assert.equal(evaluation.runtimeEfficiency.speedupVsBaseline, 10);
  assert.equal(evaluation.runtimeEfficiency.efficiencyVsReference, 1);
  assert.deepEqual(evaluation.blockingEvidence, ['correctness_failed']);
});

test('converts bottlenecks into branch hypotheses for ICR exploration', () => {
  const task = createIcrPerfBenchTask(BASE_TASK);
  const packet = createIcrPerfBenchBranchHypotheses(task);

  assert.equal(packet.kind, 'icr_perfbench_branch_hypothesis_packet');
  assert.equal(packet.lane, 'icr');
  assert.equal(packet.taskId, 'perf_two_sum_batch');
  assert.equal(packet.evidenceOnly, true);
  assert.equal(packet.promotionAllowed, false);
  assert.deepEqual(packet.hypotheses.map((hypothesis) => hypothesis.hypothesisId), [
    'perf_two_sum_batch_hypothesis_nested_scan',
    'perf_two_sum_batch_hypothesis_allocation_churn',
  ]);
  assert.deepEqual(packet.hypotheses[0], {
    hypothesisId: 'perf_two_sum_batch_hypothesis_nested_scan',
    branchId: 'branch_nested_scan',
    sourceBottleneckId: 'nested_scan',
    targetField: 'runtime_efficiency',
    statement: 'Nested scan repeats pair search for every row.',
    proposedDirection: 'replace inner search with indexed lookup',
    expectedImpact: 'high',
  });
});

test('creates an RHO replay case that can feed candidate-family comparisons', () => {
  const task = createIcrPerfBenchTask(BASE_TASK);
  const replayCase = createIcrPerfBenchReplayCase(task);

  assert.equal(replayCase.taskId, 'perf_two_sum_batch');
  assert.equal(replayCase.prompt.includes(BASE_TASK.prompt), true);
  assert.equal(replayCase.perfBenchTask, task);
  assert.deepEqual(replayCase.baseline, {
    implementation: task.baselineImplementation,
    runtimeScore: task.runtimeScore,
  });
  assert.deepEqual(replayCase.rubric, {
    correctness: task.correctnessCheck,
    runtimeEfficiency: task.runtimeScore,
    referenceOptimized: task.referenceOptimized,
  });
  assert.deepEqual(replayCase.heldoutVariants, [
    { variantId: 'correctness', focus: 'correctness' },
    { variantId: 'runtime_efficiency', focus: 'runtime_efficiency' },
  ]);
});
