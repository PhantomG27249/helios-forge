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
