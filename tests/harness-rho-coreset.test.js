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

test('selects MemGraphRAG construction failures as hard cases', () => {
  const coreset = buildRhoCoreset({
    traces: [
      {
        taskId: 'theme',
        memgraphFailure: { type: 'thematic_irrelevance', affectedNodes: ['schema_a'] },
      },
      {
        taskId: 'logical',
        graphConstructionFailures: [{ type: 'logical_conflict', factIds: ['fact_a', 'fact_b'] }],
      },
      {
        taskId: 'temporal',
        events: [{ type: 'memgraph.temporal_conflict', factIds: ['fact_old', 'fact_new'] }],
      },
      {
        taskId: 'granularity',
        memoryGraph: { granularityConflict: true },
      },
      {
        taskId: 'fragmented',
        memgraph: { fragmentationScore: 0.91 },
      },
      {
        taskId: 'activation-stall',
        memgraph: { pendingActivationStall: true },
      },
    ],
    limit: 10,
  });

  assert.deepEqual(
    coreset.items.map((item) => item.reasons.find((reason) => reason.startsWith('memgraph_'))),
    [
      'memgraph_logical_conflict',
      'memgraph_temporal_conflict',
      'memgraph_granularity_conflict',
      'memgraph_fragmentation',
      'memgraph_pending_activation_stall',
      'memgraph_thematic_irrelevance',
    ],
  );
});

test('selects compaction replay and evolution failures as hard cases', () => {
  const coreset = buildRhoCoreset({
    traces: [
      {
        taskId: 'resume-gap',
        failureModes: ['compaction_continuation_failed'],
      },
      {
        taskId: 'lost-constraints',
        compaction: { lostConstraints: ['no external API calls'] },
      },
      {
        taskId: 'hallucinated-summary',
        events: [{ type: 'compaction.hallucination_detected', summary: 'Invented approval' }],
      },
      {
        taskId: 'token-bloat',
        compaction: { tokenReduction: 0.04 },
      },
    ],
    limit: 10,
  });

  assert.deepEqual(
    coreset.items.map((item) => item.reasons.find((reason) => reason.startsWith('compaction_'))),
    [
      'compaction_lost_constraints',
      'compaction_hallucination',
      'compaction_continuation_failed',
      'compaction_token_bloat',
    ],
  );
});

test('selects compaction replay failures as hard cases', () => {
  const coreset = buildRhoCoreset({
    traces: [
      {
        taskId: 'lost-constraint',
        compactionReplay: {
          score: 0.4,
          failureModes: ['compaction_lost_constraint', 'compaction_lost_file'],
        },
      },
      {
        taskId: 'bad-trigger',
        events: [
          {
            type: 'context.compaction_replay',
            replay: { score: 0.55, failureModes: ['compaction_bad_trigger'] },
          },
        ],
      },
    ],
    limit: 5,
  });

  assert.deepEqual(
    coreset.items.map((item) => item.reasons.find((reason) => reason.startsWith('compaction_'))),
    ['compaction_lost_constraint', 'compaction_bad_trigger'],
  );
  assert.equal(coreset.items[0].score >= 5, true);
});

test('annotates selected traces with replay difficulty diversity heldout and lineage metadata', () => {
  const coreset = buildRhoCoreset({
    traces: [
      {
        taskId: 'lineage-hard',
        status: 'failed',
        failureModes: ['tool_timeout', 'retrieval_miss'],
        source: { path: 'traces/lineage-hard/events.jsonl', sha: 'abc123' },
        config: { profile: 'rho-scale', seed: 17 },
        trace: { traceId: 'trace_hard', runId: 'run_hard' },
        heldoutVariants: [
          { variantId: 'seed_17', seed: 17 },
          { variantId: 'seed_23', seed: 23 },
        ],
        events: [{ type: 'recovery.event', category: 'tool_timeout' }],
      },
    ],
    limit: 1,
  });

  assert.equal(coreset.items[0].metadata.difficulty.band, 'hard');
  assert.deepEqual(coreset.items[0].metadata.difficulty.reasons, [
    'failure_or_recovery',
    'low_completion_or_unsuccessful',
  ]);
  assert.deepEqual(coreset.items[0].metadata.diversity.keys, [
    'tool_timeout',
    'retrieval_miss',
  ]);
  assert.deepEqual(
    coreset.items[0].heldoutVariants.map((variant) => variant.variantId),
    ['seed_17', 'seed_23'],
  );
  assert.deepEqual(coreset.items[0].lineage, {
    source: { path: 'traces/lineage-hard/events.jsonl', sha: 'abc123' },
    config: { profile: 'rho-scale', seed: 17 },
    trace: { traceId: 'trace_hard', runId: 'run_hard' },
  });
});

test('uses precomputed embeddings to avoid near-duplicate hard cases', () => {
  const coreset = buildRhoCoreset({
    traces: [
      { taskId: 'cluster-a', status: 'failed', failureModes: ['same'], embedding: [1, 0] },
      { taskId: 'cluster-a-copy', status: 'failed', failureModes: ['same'], embedding: [0.99, 0.01] },
      { taskId: 'cluster-b', status: 'failed', failureModes: ['same'], embedding: [0, 1] },
      { taskId: 'cluster-c', status: 'failed', failureModes: ['same'], embedding: [-1, 0] },
    ],
    limit: 3,
  });

  assert.equal(coreset.selectedCount, 3);
  assert.equal(coreset.items.some((item) => item.taskId === 'cluster-a-copy'), false);
  assert.deepEqual(
    coreset.items.map((item) => item.metadata.diversity.embeddingAvailable),
    [true, true, true],
  );
  assert.equal(coreset.selection?.strategy, 'embedding_dpp_like');
});

test('uses verifier case embeddings when selecting DPP-like replay cases', () => {
  const coreset = buildRhoCoreset({
    verifierCases: [
      { caseId: 'verifier-a', classification: 'falseNegative', embedding: [1, 0] },
      { caseId: 'verifier-a-copy', classification: 'falseNegative', embedding: [0.98, 0.02] },
      { caseId: 'verifier-c', classification: 'falseNegative', embedding: [-1, 0] },
    ],
    limit: 2,
  });

  assert.deepEqual(coreset.items.map((item) => item.caseId), ['verifier-a', 'verifier-c']);
  assert.equal(coreset.items.every((item) => item.metadata.diversity.embeddingAvailable), true);
});

test('uses supplied embedding indexes and deterministic fallback embeddings for diverse replay selection', () => {
  const traces = [
    {
      taskId: 'external-a',
      status: 'failed',
      failureModes: ['same'],
      prompt: 'repair websocket reconnect loop',
    },
    {
      taskId: 'external-a-copy',
      status: 'failed',
      failureModes: ['same'],
      prompt: 'repair websocket reconnect retry path',
    },
    {
      taskId: 'fallback-memory',
      status: 'failed',
      failureModes: ['same'],
      prompt: 'rebuild memory graph retrieval facts',
    },
  ];

  const first = buildRhoCoreset({
    traces,
    limit: 2,
    embeddingIndex: {
      'external-a': [1, 0, 0],
      'external-a-copy': [0.99, 0.01, 0],
    },
    fallbackEmbeddingDimensions: 8,
  });
  const second = buildRhoCoreset({
    traces: [...traces].reverse(),
    limit: 2,
    embeddingIndex: {
      'external-a': [1, 0, 0],
      'external-a-copy': [0.99, 0.01, 0],
    },
    fallbackEmbeddingDimensions: 8,
  });

  assert.deepEqual(first.items.map((item) => item.taskId), ['external-a', 'fallback-memory']);
  assert.deepEqual(second.items.map((item) => item.taskId), ['external-a', 'fallback-memory']);
  assert.deepEqual(
    first.items.map((item) => item.metadata.diversity.embeddingSource),
    ['provided', 'fallback'],
  );
  assert.equal(first.selection.strategy, 'embedding_dpp_like');
  assert.equal(first.selection.fallbackEmbeddedCandidates, 1);
});
