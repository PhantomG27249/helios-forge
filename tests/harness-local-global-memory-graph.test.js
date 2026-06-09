import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  activateStableSchemas,
  createGlobalMemoryLayers,
  upsertFact,
  upsertPassage,
  upsertSchema,
} from '../src/harness-sidecar/memory/globalMemoryLayers.js';
import {
  addLocalObservation,
  createLocalMemoryGraph,
} from '../src/harness-sidecar/memory/localMemoryGraph.js';
import { proposeGlobalMemoryPromotions } from '../src/harness-sidecar/memory/globalMemoryPromotion.js';
import { createMemoryGraphRuntime } from '../src/harness-sidecar/memory/memoryGraphRuntime.js';
import { runMemoryExtractionSociety } from '../src/harness-sidecar/memory/memoryExtractionSociety.js';
import { mergeSwarmCellMemoryGraphs } from '../src/harness-sidecar/memory/swarmCellMemoryGraph.js';
import { retrieveHierarchicalMemoryContext } from '../src/harness-sidecar/rag/hierarchicalMemoryRetriever.js';

async function makeTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-local-global-memory-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('local memory graph records agent-scoped pending facts', () => {
  const graph = createLocalMemoryGraph({ agentId: 'code.impl' });

  addLocalObservation(graph, {
    kind: 'fact',
    subject: 'subagentRunner',
    relation: 'needs',
    object: 'evolutionOutput',
    passageId: 'trace-1',
  });

  assert.equal(graph.agentId, 'code.impl');
  assert.equal(graph.facts[0].status, 'local_pending');
});

test('swarm cell merge combines duplicate local facts into pending global promotions', () => {
  const implGraph = createLocalMemoryGraph({ agentId: 'code.impl' });
  const testGraph = createLocalMemoryGraph({ agentId: 'code.test' });

  addLocalObservation(implGraph, {
    kind: 'fact',
    subject: 'A',
    relation: 'requires',
    object: 'B',
    passageId: 'p1',
  });
  addLocalObservation(testGraph, {
    kind: 'fact',
    subject: 'A',
    relation: 'requires',
    object: 'B',
    passageId: 'p2',
  });

  const cellGraph = mergeSwarmCellMemoryGraphs({
    cellId: 'code',
    localGraphs: [implGraph, testGraph],
  });
  const proposal = proposeGlobalMemoryPromotions({
    cellGraph,
    supportThreshold: 2,
  });

  assert.equal(proposal.facts.length, 1);
  assert.equal(proposal.facts[0].status, 'pending');
  assert.deepEqual(proposal.facts[0].passageIds, ['p1', 'p2']);
});

test('memory extraction society emits passages schemas facts and contradictions', () => {
  const result = runMemoryExtractionSociety({
    observations: [
      { text: 'Helios uses local meta harnesses.', source: 'trace-1' },
    ],
  });

  assert.equal(result.passages.length, 1);
  assert.equal(result.passages[0].passageId, 'trace-1');
  assert.equal(Array.isArray(result.schemas), true);
  assert.equal(Array.isArray(result.facts), true);
  assert.equal(Array.isArray(result.contradictions), true);
});

test('memory graph runtime persists promoted global layers and constructed graph', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({ workspaceRoot });

    const result = await runtime.ingestPromotion({
      passages: [{ passageId: 'p1', text: 'A requires B.' }],
      schemas: [{ headType: 'module', relation: 'requires', tailType: 'feature', frequency: 2 }],
      facts: [{ subject: 'A', relation: 'requires', object: 'B', passageIds: ['p1'] }],
    });

    assert.equal(result.layers.facts.length, 1);
    assert.equal(result.graph.stats.passageCount, 1);
  });
});

test('hierarchical memory retriever returns active facts passages and summary counts', () => {
  const layers = createGlobalMemoryLayers();
  upsertPassage(layers, { passageId: 'p1', text: 'A requires B.' });
  upsertSchema(layers, { headType: 'module', relation: 'requires', tailType: 'feature', frequency: 2 });
  upsertFact(layers, {
    subject: 'A',
    subjectType: 'module',
    relation: 'requires',
    object: 'B',
    objectType: 'feature',
    passageIds: ['p1'],
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });

  const context = retrieveHierarchicalMemoryContext({
    query: 'A requires B',
    layers,
    graph: { stats: { activeFactCount: 1 } },
    maxItems: 5,
  });

  assert.equal(context.items.some((item) => item.kind === 'active_fact'), true);
  assert.equal(context.items.some((item) => item.kind === 'passage'), true);
  assert.equal(context.summary.activeFactCount, 1);
});
