import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createGraphMemoryStore,
  getGraphMemorySnapshotPath,
  validateGraphSnapshotId,
} from '../src/harness-sidecar/memory/graphMemoryStore.js';
import { maintainGraphMemorySnapshot } from '../src/harness-sidecar/memory/graphMemoryMaintenance.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-graph-memory-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function reviewedMemory(overrides = {}) {
  return {
    memoryId: 'mem_fix_0001',
    type: 'reusable_fix',
    summary: 'Run the focused node --test command before the full suite.',
    tags: ['harness', 'tests'],
    taskKeywords: ['graph memory', 'maintenance'],
    evidence: ['tests/harness-graph-memory-maintenance.test.js'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
    provenance: [{ taskId: 'task_graph', evidence: ['tests/harness-graph-memory-maintenance.test.js'] }],
    ...overrides,
  };
}

test('graph memory store persists schema-versioned snapshots inside the workspace', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createGraphMemoryStore({ workspaceRoot });
    const snapshotPath = getGraphMemorySnapshotPath(workspaceRoot);

    assert.equal(store.filePath, snapshotPath);
    assert.equal(snapshotPath.startsWith(path.resolve(workspaceRoot)), true);

    const empty = await store.load();
    assert.equal(empty.schemaVersion, 1);
    assert.deepEqual(empty.nodes, []);
    assert.deepEqual(empty.edges, []);
    assert.deepEqual(empty.rankings, {});
    assert.deepEqual(empty.staleReviewItems, []);
    assert.deepEqual(empty.conflictReviewItems, []);

    await store.save({
      ...empty,
      nodes: [{ id: 'mem_fix_0001', kind: 'memory', type: 'reusable_fix' }],
    });
    await store.update((snapshot) => ({
      ...snapshot,
      rankings: {
        ...snapshot.rankings,
        mem_fix_0001: { score: 42, feedbackScore: 2, evalScore: 40 },
      },
    }));

    const raw = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.equal(raw.schemaVersion, 1);
    assert.deepEqual(raw.nodes.map((node) => node.id), ['mem_fix_0001']);
    assert.equal(raw.rankings.mem_fix_0001.score, 42);
  });
});

test('graph memory store rejects traversal-ish ids before snapshot persistence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createGraphMemoryStore({ workspaceRoot });
    const empty = await store.load();

    assert.equal(validateGraphSnapshotId('mem_fix_0001'), 'mem_fix_0001');
    assert.throws(() => validateGraphSnapshotId('../mem_escape'), /Invalid graph snapshot id/);
    await assert.rejects(
      store.save({
        ...empty,
        nodes: [{ id: 'mem/escape', kind: 'memory' }],
      }),
      /Invalid graph snapshot id/,
    );
  });
});

test('maintenance rebuilds graph snapshot with rankings, review items, and eval summaries', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const promotedMemories = [
      reviewedMemory({
        memoryId: 'mem_fact_0001',
        type: 'fact',
        subject: 'verifier.command',
        predicate: 'equals',
        object: 'node --test',
        summary: 'The verifier command is node --test.',
      }),
      reviewedMemory({
        memoryId: 'mem_fix_0001',
        supersedes: ['mem_old_0001'],
      }),
      reviewedMemory({
        memoryId: 'mem_old_0001',
        summary: 'Use the legacy full npm test command first.',
        stale: true,
        supersededBy: 'mem_fix_0001',
      }),
    ];
    const candidates = [
      reviewedMemory({
        memoryId: 'mem_fact_0002',
        type: 'fact',
        subject: 'verifier.command',
        predicate: 'equals',
        object: 'npm test',
        summary: 'The verifier command is npm test.',
        evidence: ['docs/legacy.md'],
      }),
    ];
    const traceSummaries = [
      {
        traceId: 'trace_graph_0001',
        taskId: 'task_graph',
        summary: 'Focused graph memory maintenance run passed.',
        memoryIds: ['mem_fix_0001'],
        outcome: 'passed',
      },
    ];
    const feedback = [
      { memoryId: 'mem_fix_0001', signal: 'positive', weight: 3 },
      { memoryId: 'mem_old_0001', signal: 'negative', weight: 2 },
    ];
    const evalSets = [
      {
        evalSetId: 'eval_graph_0001',
        summary: 'Maintenance snapshot regression eval.',
        results: [
          { memoryId: 'mem_fix_0001', passed: true, score: 1 },
          { memoryId: 'mem_old_0001', passed: false, score: 0 },
        ],
      },
    ];

    const result = await maintainGraphMemorySnapshot({
      workspaceRoot,
      promotedMemories,
      candidates,
      traceSummaries,
      feedback,
      evalSets,
    });
    const snapshot = await createGraphMemoryStore({ workspaceRoot }).load();

    assert.deepEqual(result.snapshot, snapshot);
    assert.equal(snapshot.nodes.some((node) => node.id === 'mem_fix_0001' && node.kind === 'memory'), true);
    assert.equal(snapshot.nodes.some((node) => node.id === 'trace_graph_0001' && node.kind === 'trace'), true);
    assert.equal(snapshot.edges.some((edge) => (
      edge.from === 'mem_fix_0001'
      && edge.to === 'mem_old_0001'
      && edge.type === 'supersedes'
    )), true);
    assert.equal(snapshot.edges.some((edge) => (
      edge.from === 'trace_graph_0001'
      && edge.to === 'mem_fix_0001'
      && edge.type === 'observed_memory'
    )), true);
    assert.equal(snapshot.rankings.mem_fix_0001.feedbackScore, 3);
    assert.equal(snapshot.rankings.mem_old_0001.feedbackScore, -2);
    assert.equal(snapshot.rankings.mem_fix_0001.score > snapshot.rankings.mem_old_0001.score, true);
    assert.deepEqual(snapshot.rankedContextItems.map((item) => item.memoryId), [
      'mem_fix_0001',
      'mem_fact_0001',
      'mem_fact_0002',
      'mem_old_0001',
    ]);
    assert.equal(snapshot.rankedContextItems[0].source, 'graph_memory');
    assert.equal(snapshot.rankedContextItems[0].sourceLabel, 'graph-memory:mem_fix_0001');
    assert.equal(snapshot.rankedContextItems[0].ranking.feedbackScore, 3);
    assert.deepEqual(snapshot.rankedContextItems[0].reasons, [
      'rank:graph_memory',
      'review:reviewed',
      'validator_backed',
      'feedback:positive',
      'eval:100',
      'trace_observed:1',
    ]);
    assert.equal(snapshot.rankedContextItems[0].provenance[0].taskId, 'task_graph');
    assert.deepEqual(snapshot.staleReviewItems.map((item) => item.memoryId), ['mem_old_0001']);
    assert.equal(snapshot.staleReviewItems[0].supersededBy, 'mem_fix_0001');
    assert.equal(snapshot.conflictReviewItems.length, 1);
    assert.deepEqual(
      snapshot.conflictReviewItems[0].conflictingMemoryIds.sort(),
      ['mem_fact_0001', 'mem_fact_0002'],
    );
    assert.deepEqual(snapshot.evalSummaries, [
      {
        evalSetId: 'eval_graph_0001',
        summary: 'Maintenance snapshot regression eval.',
        totalResults: 2,
        passedCount: 1,
        averageScore: 50,
      },
    ]);
  });
});

test('maintenance applies eval hooks then decays and consolidates memory records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await maintainGraphMemorySnapshot({
      workspaceRoot,
      promotedMemories: [
        reviewedMemory({
          memoryId: 'mem_runtime_a',
          type: 'fact',
          subject: 'memoryGraphRuntime',
          predicate: 'composes',
          object: 'extraction society',
          summary: 'Runtime composes the extraction society.',
          lastUsedAt: '2026-06-09T00:00:00.000Z',
        }),
        reviewedMemory({
          memoryId: 'mem_runtime_b',
          type: 'fact',
          subject: 'memoryGraphRuntime',
          predicate: 'composes',
          object: 'extraction society',
          summary: 'The memory runtime composes extraction agents.',
          evidence: ['tests/harness-local-global-memory-graph.test.js'],
          lastUsedAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
      now: '2026-06-10T00:00:00.000Z',
      decay: { halfLifeDays: 30, staleAfterDays: 90 },
      evalHooks: [{
        evalSetId: 'eval_hook_memory_runtime',
        summary: 'Runtime primitive hook.',
        evaluate: (record) => ({
          passed: record.subject === 'memoryGraphRuntime',
          score: record.memoryId === 'mem_runtime_a' ? 1 : 0.25,
          reasons: ['subject_grounded'],
        }),
      }],
    });

    const snapshot = result.snapshot;

    assert.equal(snapshot.evalSummaries[0].evalSetId, 'eval_hook_memory_runtime');
    assert.equal(snapshot.rankings.mem_runtime_a.evalScore, 100);
    assert.equal(snapshot.rankings.mem_runtime_b.decayScore < snapshot.rankings.mem_runtime_a.decayScore, true);
    assert.equal(snapshot.rankedContextItems.find((item) => item.memoryId === 'mem_runtime_b').stale, true);
    assert.deepEqual(snapshot.consolidationItems, [{
      queueId: 'consolidate_mem_runtime_a_mem_runtime_b',
      type: 'memory_consolidation',
      status: 'needs_review',
      memoryIds: ['mem_runtime_a', 'mem_runtime_b'],
      subject: 'memoryGraphRuntime',
      predicate: 'composes',
      object: 'extraction society',
      evidence: [
        'tests/harness-graph-memory-maintenance.test.js',
        'tests/harness-local-global-memory-graph.test.js',
      ],
    }]);
  });
});
