import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activateStableSchemas,
  createGlobalMemoryLayers,
  upsertFact,
  upsertPassage,
  upsertSchema,
} from '../src/harness-sidecar/memory/globalMemoryLayers.js';
import { constructMemoryGuidedGraph } from '../src/harness-sidecar/memory/memoryGraphConstructor.js';
import { composeGraphRagContext } from '../src/harness-sidecar/rag/graphRagComposer.js';
import { retrieveMemoryAwareGraphContext } from '../src/harness-sidecar/rag/memoryAwareGraphRetriever.js';
import { composeUnifiedContext } from '../src/harness-sidecar/rag/unifiedContextComposer.js';

function graphFixture() {
  const layers = createGlobalMemoryLayers();
  upsertPassage(layers, {
    passageId: 'passage_schema',
    text: 'Schema threshold controls global memory fact activation.',
    path: 'docs/memory.md',
    source: 'doc',
  });
  upsertPassage(layers, {
    passageId: 'passage_bridge_only',
    text: 'Unrelated bridge-only note.',
    path: 'docs/unrelated.md',
    source: 'doc',
  });
  upsertSchema(layers, { headType: 'module', relation: 'tunes', tailType: 'policy_knob' });
  upsertSchema(layers, { headType: 'module', relation: 'tunes', tailType: 'policy_knob' });
  upsertFact(layers, {
    subject: 'memoryPolicyEvolution',
    subjectType: 'module',
    relation: 'tunes',
    object: 'schemaThreshold',
    objectType: 'policy_knob',
    passageIds: ['passage_schema'],
    confidence: 0.9,
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });
  upsertFact(layers, {
    subject: 'memoryPolicyEvolution',
    subjectType: 'module',
    relation: 'tunes',
    object: 'pendingTtl',
    objectType: 'policy_knob',
    passageIds: ['passage_schema'],
    status: 'pending',
    confidence: 0.9,
  });
  return constructMemoryGuidedGraph({ layers });
}

test('memory-aware retrieval seeds from matching schema fact and passage nodes', () => {
  const graph = graphFixture();
  const items = retrieveMemoryAwareGraphContext({
    graph,
    query: 'schema threshold activation memory policy',
    maxItems: 6,
  });

  assert.equal(items.length > 0, true);
  assert.equal(items[0].sourceLabel.startsWith('memgraph:fact:'), true);
  assert.equal(items.some((item) => item.sourceLabel.startsWith('memgraph:schema:')), true);
  assert.equal(items.some((item) => item.sourceLabel.startsWith('memgraph:passage:')), true);
  assert.equal(items.every((item) => item.score >= 0 && item.score <= 1), true);
});

test('retrieval prefers active facts, includes provenance passages, and caps bridge-only noise', () => {
  const graph = graphFixture();
  graph.nodes.push({
    id: 'memgraph_entity_noise',
    kind: 'entity',
    label: 'unrelated bridge-only node',
    type: 'concept',
  });
  graph.edges.push({
    from: 'memgraph_entity_noise',
    to: 'memgraph_entity_schemaThreshold',
    type: 'memgraph_bridge',
    reason: 'similarity_above_threshold',
    provenance: ['passage_bridge_only'],
  });

  const items = retrieveMemoryAwareGraphContext({
    graph,
    query: 'schemaThreshold',
    maxItems: 5,
    iterations: 8,
    restartProbability: 0.2,
  });

  const factItems = items.filter((item) => item.sourceLabel.startsWith('memgraph:fact:'));
  assert.equal(factItems[0].status, 'active');
  assert.equal(items.some((item) => item.id === 'memgraph_passage_passage_schema'), true);
  assert.equal(
    items.filter((item) => item.reasons.includes('bridge_only')).length <= 1,
    true,
  );
});

test('GraphRAG and unified context composers accept memory-aware graph retrieval items', () => {
  const graph = graphFixture();
  const graphContext = composeGraphRagContext({
    graph,
    memoryAwareQuery: 'schema threshold',
    maxItems: 4,
  });
  const unified = composeUnifiedContext({
    taskId: 'task_memgraph_rag',
    maxTokens: 200,
    memoryGraphItems: graphContext.items,
  });

  assert.equal(graphContext.source, 'memory_aware_knowledge_graph');
  assert.equal(graphContext.items.some((item) => item.source === 'memory_graph'), true);
  assert.equal(unified.sources.includes('memory_graph'), true);
  assert.equal(unified.sourceLabels.some((label) => label.startsWith('memgraph:fact:')), true);
});
