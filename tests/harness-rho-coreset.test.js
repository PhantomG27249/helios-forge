import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRhoCoreset } from '../src/harness-sidecar/rho/coresetBuilder.js';

test('ranks recovery events, budget gates, failures, and low completion above easy traces', () => {
  const traces = [
    {
      taskId: 'easy',
      status: 'success',
      subgoalCompletion: 1,
      events: [{ type: 'progress.ok' }],
    },
    {
      taskId: 'hard',
      status: 'failed',
      subgoalCompletion: 0.25,
      events: [
        { type: 'recovery.event', category: 'tool_timeout' },
        { type: 'budget.gate', percent: 92 },
      ],
    },
  ];

  const coreset = buildRhoCoreset({ traces, limit: 2 });

  assert.deepEqual(coreset.items.map((item) => item.taskId), ['hard', 'easy']);
  assert.equal(coreset.items[0].score, 7);
  assert.deepEqual(coreset.items[0].reasons, [
    'failure_or_recovery',
    'budget_gate',
    'low_completion_or_unsuccessful',
  ]);
  assert.equal(coreset.totalCandidates, 2);
  assert.equal(coreset.selectedCount, 2);
});

test('enforces limit and preserves diversity across categories before filling by score', () => {
  const traces = [
    {
      taskId: 'timeout-a',
      status: 'failed',
      failureModes: ['tool_timeout'],
      events: [{ type: 'recovery.event', category: 'tool_timeout' }],
    },
    {
      taskId: 'timeout-b',
      status: 'failed',
      failureModes: ['tool_timeout'],
      events: [{ type: 'recovery.event', category: 'tool_timeout' }],
    },
    {
      taskId: 'budget-a',
      status: 'success',
      failureModes: ['budget_gate'],
      budgetGates: [{ percent: 95 }],
    },
    {
      taskId: 'retrieval-a',
      status: 'failed',
      failureModes: ['retrieval_miss'],
      subgoalCompletion: 0.4,
    },
  ];

  const coreset = buildRhoCoreset({
    traces,
    limit: 3,
    diversityKey: (trace) => trace.failureModes[0],
  });

  assert.equal(coreset.selectedCount, 3);
  assert.deepEqual(coreset.items.map((item) => item.taskId), [
    'retrieval-a',
    'timeout-a',
    'budget-a',
  ]);
  assert.deepEqual(coreset.items.map((item) => item.diversityKey), [
    'retrieval_miss',
    'tool_timeout',
    'budget_gate',
  ]);
});

test('returns deterministic ordering for equal-score traces', () => {
  const traces = [
    { taskId: 'task-c', status: 'failed' },
    { taskId: 'task-a', status: 'failed' },
    { taskId: 'task-b', status: 'failed' },
  ];

  const first = buildRhoCoreset({ traces, limit: 3 });
  const second = buildRhoCoreset({ traces: [...traces].reverse(), limit: 3 });

  assert.deepEqual(first.items.map((item) => item.taskId), ['task-a', 'task-b', 'task-c']);
  assert.deepEqual(second.items.map((item) => item.taskId), ['task-a', 'task-b', 'task-c']);
});

test('selects verifier cases for false positives false negatives ambiguous scores cost and flakiness', () => {
  const coreset = buildRhoCoreset({
    traces: [{ taskId: 'trace-easy', status: 'success' }],
    verifierCases: [
      { caseId: 'visual-fp', classification: 'falsePositive', verifier: 'visual-ui' },
      { caseId: 'visual-fn', classification: 'falseNegative', verifier: 'visual-ui' },
      { caseId: 'visual-ambiguous', score: 0.74, thresholds: { pass: 0.75 }, kind: 'visual' },
      { caseId: 'visual-costly', cost: 1.2, budget: { maxCost: 0.5 } },
      { caseId: 'visual-flaky', flaky: true },
    ],
    limit: 10,
  });

  const verifierItems = coreset.items.filter((item) => item.source === 'verifier_case');
  assert.deepEqual(
    verifierItems.map((item) => item.caseId),
    ['visual-fn', 'visual-fp', 'visual-flaky', 'visual-ambiguous', 'visual-costly'],
  );
  assert.deepEqual(
    verifierItems.map((item) => item.reasons[0]),
    [
      'verifier_false_negative',
      'verifier_false_positive',
      'verifier_flaky',
      'verifier_ambiguous_visual_score',
      'verifier_high_cost',
    ],
  );
  assert.equal(coreset.totalCandidates, 6);
});

test('selects visual verifier cases from outcomes tags artifacts and tool names without thresholds', () => {
  const coreset = buildRhoCoreset({
    verifierCases: [
      { caseId: 'visual-outcome', outcome: 'ambiguousVisualScore' },
      { caseId: 'visual-tags', tags: ['vlm', 'screenshot'] },
      { caseId: 'visual-artifacts', visualArtifacts: [{ path: 'diff.png' }] },
      { caseId: 'visual-tool', toolName: 'vlm-screenshot-verifier' },
    ],
    limit: 10,
  });

  assert.deepEqual(
    coreset.items.map((item) => item.caseId),
    ['visual-outcome', 'visual-artifacts', 'visual-tags', 'visual-tool'],
  );
  assert.deepEqual(
    coreset.items.map((item) => item.reasons[0]),
    [
      'verifier_ambiguous_visual_score',
      'verifier_visual_evidence',
      'verifier_visual_evidence',
      'verifier_visual_evidence',
    ],
  );
  assert.deepEqual(coreset.items.map((item) => item.score), [3, 2, 2, 2]);
});
