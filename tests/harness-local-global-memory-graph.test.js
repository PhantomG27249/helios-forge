import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { constructMemoryGuidedGraph } from '../src/harness-sidecar/memory/memoryGraphConstructor.js';
import {
  addLocalObservation,
  createLocalMemoryGraph,
} from '../src/harness-sidecar/memory/localMemoryGraph.js';
import { proposeGlobalMemoryPromotions } from '../src/harness-sidecar/memory/globalMemoryPromotion.js';
import { createMemoryGraphRuntime } from '../src/harness-sidecar/memory/memoryGraphRuntime.js';
import { runMemoryExtractionSociety } from '../src/harness-sidecar/memory/memoryExtractionSociety.js';
import { mergeSwarmCellMemoryGraphs } from '../src/harness-sidecar/memory/swarmCellMemoryGraph.js';
import {
  createLaneMemoryGraphContextPacket,
  retrieveHierarchicalMemoryContext,
} from '../src/harness-sidecar/rag/hierarchicalMemoryRetriever.js';

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

test('memory extraction society uses guarded injected model hooks only when enabled', () => {
  let hookCalls = 0;
  const modelHooks = {
    extractFacts: ({ observations }) => {
      hookCalls += 1;
      assert.equal(observations[0].source, 'trace-hook');
      return [{
        subject: 'memoryExtractionSociety',
        subjectType: 'module',
        relation: 'can_use',
        object: 'guarded model hooks',
        objectType: 'capability',
        passageIds: ['trace-hook'],
        confidence: 0.91,
      }];
    },
  };

  const disabled = runMemoryExtractionSociety({
    observations: [{ text: 'Hook source text.', source: 'trace-hook' }],
    modelHooks,
  });
  const enabled = runMemoryExtractionSociety({
    observations: [{ text: 'Hook source text.', source: 'trace-hook' }],
    modelHooks,
    modelAssistance: { enabled: true },
  });

  assert.equal(hookCalls, 1);
  assert.deepEqual(disabled.facts, []);
  assert.equal(enabled.facts[0].object, 'guarded model hooks');
  assert.deepEqual(enabled.hookTrace, ['extractFacts']);
});

test('memory extraction society guards role outputs with passage provenance', () => {
  const result = runMemoryExtractionSociety({
    observations: [{ text: 'MemGraphRAG uses guarded extraction roles.', source: 'trace-role-1' }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: () => [{ passageId: 'trace-role-1', text: 'MemGraphRAG uses guarded extraction roles.' }],
      fact_extractor: () => [
        {
          subject: 'MemGraphRAG',
          subjectType: 'system',
          relation: 'uses',
          object: 'guarded extraction roles',
          objectType: 'capability',
          passageIds: ['trace-role-1'],
          confidence: 0.93,
        },
        {
          subject: 'MemGraphRAG',
          subjectType: 'system',
          relation: 'promotes',
          object: 'unsupported claims',
          objectType: 'risk',
          passageIds: ['missing-passage'],
          confidence: 0.99,
        },
      ],
      evaluator: ({ facts }) => [{ metric: 'guardedFacts', value: facts.length }],
    },
  });

  assert.deepEqual(result.roles, [
    'passage_collector',
    'schema_proposer',
    'fact_extractor',
    'contradiction_critic',
    'merge_planner',
    'graph_constructor',
    'retriever',
    'evaluator',
  ]);
  assert.deepEqual(result.facts.map((fact) => fact.object), ['guarded extraction roles']);
  assert.deepEqual(result.rejectedFacts.map((fact) => fact.object), ['unsupported claims']);
  assert.deepEqual(result.rejectedFacts[0].guard.reasons, ['missing_passage_support']);
  assert.equal(result.roleOutputs.evaluator[0].metric, 'guardedFacts');
  assert.deepEqual(result.roleTrace, ['evaluator', 'fact_extractor', 'passage_collector']);
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

test('memory graph runtime adjudicates conflicts against retrieved provenance passages', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({
      workspaceRoot,
      schemaThreshold: 1,
      conflictPolicy: { requirePassageSupport: true },
    });

    await runtime.ingestPromotion({
      passages: [{ passageId: 'passage_old', text: 'The retriever uses lexical search for startup context.' }],
      schemas: [{ headType: 'service', relation: 'uses', tailType: 'backend', frequency: 1 }],
      facts: [{
        subject: 'retriever',
        subjectType: 'service',
        relation: 'uses',
        object: 'lexical search',
        objectType: 'backend',
        passageIds: ['passage_old'],
        confidence: 0.8,
      }],
    });

    const result = await runtime.ingestPromotion({
      passages: [{ passageId: 'passage_new', text: 'The current retriever uses graph search for startup context.' }],
      schemas: [{ headType: 'service', relation: 'uses', tailType: 'backend', frequency: 1 }],
      facts: [{
        subject: 'retriever',
        subjectType: 'service',
        relation: 'uses',
        object: 'graph search',
        objectType: 'backend',
        passageIds: ['passage_new'],
        confidence: 0.8,
      }],
    });

    assert.equal(result.conflictDecisions[0].action, 'discard');
    assert.equal(result.conflictDecisions[0].targetFactId.includes('lexical_search'), true);
    assert.equal(result.conflictDecisions[0].reasons.includes('retrieved_passage_supports_new_fact'), true);
    assert.equal(result.layers.facts.find((fact) => fact.object === 'lexical search').status, 'discarded');
    assert.equal(result.layers.facts.find((fact) => fact.object === 'graph search').status, 'active');
  });
});

test('memory graph runtime loads persisted global graph snapshots', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({ workspaceRoot });
    await runtime.ingestPromotion({
      passages: [{ passageId: 'p1', text: 'A requires B.' }],
      facts: [{ subject: 'A', relation: 'requires', object: 'B', passageIds: ['p1'] }],
    });

    const reloaded = createMemoryGraphRuntime({ workspaceRoot });
    const graph = await reloaded.loadGraph();

    assert.equal(graph.stats.passageCount, 1);
  });
});

test('memory graph runtime composes extraction society into local cell and global promotion', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({ workspaceRoot, schemaThreshold: 1 });

    const result = await runtime.ingestObservations({
      agentId: 'memory.impl',
      cellId: 'memory',
      supportThreshold: 1,
      observations: [{
        text: 'The memory runtime composes extraction roles.',
        source: 'trace-runtime-1',
        subject: 'memoryGraphRuntime',
        subjectType: 'module',
        relation: 'composes',
        object: 'extraction society',
        objectType: 'runtime_primitive',
        confidence: 0.94,
      }],
    });

    assert.deepEqual(result.extraction.roles, [
      'passage_collector',
      'schema_proposer',
      'fact_extractor',
      'contradiction_critic',
      'merge_planner',
      'graph_constructor',
      'retriever',
      'evaluator',
    ]);
    assert.equal(result.localGraph.agentId, 'memory.impl');
    assert.equal(result.cellGraph.cellId, 'memory');
    assert.deepEqual(result.promotion.facts.map((fact) => fact.status), ['pending']);
    assert.equal(result.layers.facts[0].status, 'active');
    assert.equal(result.graph.stats.activeFactCount, 1);
  });
});

test('memory graph runtime reports and persists legacy schema migrations', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const memoryDir = path.join(workspaceRoot, '.harness', 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, 'global-layers.json'),
      `${JSON.stringify({
        passages: [{ passageId: 'legacy-p1', text: 'Legacy runtime fact.' }],
        schemas: [{ headType: 'module', relation: 'keeps', tailType: 'version', frequency: 1 }],
        facts: [{
          subject: 'memoryGraphRuntime',
          subjectType: 'module',
          relation: 'keeps',
          object: 'schema migrations',
          objectType: 'version',
          passageIds: ['legacy-p1'],
        }],
      }, null, 2)}\n`,
      'utf8',
    );

    const runtime = createMemoryGraphRuntime({ workspaceRoot, schemaThreshold: 1 });
    const result = await runtime.ingestPromotion({});
    const persisted = JSON.parse(await readFile(path.join(memoryDir, 'global-layers.json'), 'utf8'));

    assert.deepEqual(result.migrations.map((migration) => migration.id), ['global_layers_v0_to_v1']);
    assert.equal(persisted.schemaVersion, result.schemaVersion);
    assert.equal(persisted.migrationHistory[0].id, 'global_layers_v0_to_v1');
    assert.equal(result.layers.facts[0].status, 'active');
  });
});

test('memory graph runtime preserves layer and graph migration records across rebuilds', async () => {
  await makeTempWorkspace(async (workspaceRoot) => {
    const memoryDir = path.join(workspaceRoot, '.harness', 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, 'global-layers.json'),
      `${JSON.stringify({
        schemaVersion: 0,
        passages: [{ passageId: 'legacy-p1', text: 'Legacy migration fact.' }],
        facts: [{
          subject: 'memoryGraphRuntime',
          relation: 'tracks',
          object: 'layer migrations',
          passageIds: ['legacy-p1'],
        }],
      }, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(memoryDir, 'global-graph.json'),
      `${JSON.stringify({
        schemaVersion: 0,
        nodes: [{ id: 'legacy_node', kind: 'legacy' }],
        edges: [],
        migrationHistory: [{ id: 'legacy_custom_migration', fromVersion: -1, toVersion: 0, target: 'global_graph' }],
      }, null, 2)}\n`,
      'utf8',
    );

    const runtime = createMemoryGraphRuntime({ workspaceRoot, schemaThreshold: 1 });
    const result = await runtime.ingestPromotion({
      passages: [{ passageId: 'p2', text: 'Runtime tracks graph migrations.' }],
      schemas: [{ headType: 'module', relation: 'tracks', tailType: 'version_record', frequency: 1 }],
      facts: [{
        subject: 'memoryGraphRuntime',
        relation: 'tracks',
        object: 'graph migrations',
        objectType: 'version_record',
        passageIds: ['p2'],
      }],
    });
    const persistedGraph = JSON.parse(await readFile(path.join(memoryDir, 'global-graph.json'), 'utf8'));

    assert.deepEqual(result.migrations.map((migration) => migration.id), [
      'global_graph_v0_to_v1',
      'global_layers_v0_to_v1',
    ]);
    assert.deepEqual(persistedGraph.migrationHistory.map((migration) => migration.id), [
      'global_graph_v0_to_v1',
      'legacy_custom_migration',
    ]);
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
  assert.equal(context.items.some((item) => item.kind === 'graph_summary'), true);
  assert.equal(context.summary.activeFactCount, 1);
});

test('hierarchical memory retriever accepts snapshots budgets and graph bridge context', () => {
  const layers = createGlobalMemoryLayers();
  upsertPassage(layers, { passageId: 'p1', text: 'Module A requires feature B.' });
  upsertPassage(layers, { passageId: 'p2', text: 'Module C requires feature B.' });
  upsertSchema(layers, { headType: 'module', relation: 'requires', tailType: 'feature', frequency: 2 });
  upsertFact(layers, {
    subject: 'Module A',
    subjectType: 'module',
    relation: 'requires',
    object: 'Feature B',
    objectType: 'feature',
    passageIds: ['p1'],
  });
  upsertFact(layers, {
    subject: 'Module C',
    subjectType: 'module',
    relation: 'requires',
    object: 'Feature B',
    objectType: 'feature',
    passageIds: ['p2'],
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });
  const graph = constructMemoryGuidedGraph({ layers });

  const context = retrieveHierarchicalMemoryContext({
    query: 'Module A requires Feature B',
    snapshot: { layers, graph },
    maxItems: 8,
    budgets: { graphItems: 3, maxBridgeItems: 2, iterations: 8 },
  });

  assert.equal(context.items.some((item) => item.kind === 'bridge'), true);
  assert.equal(context.items.some((item) => item.source === 'memory_graph'), true);
  assert.equal(context.summary.bridgeCount >= 1, true);
});

test('hierarchical memory retriever honors zero item budgets', () => {
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
  const graph = constructMemoryGuidedGraph({ layers });

  const noItems = retrieveHierarchicalMemoryContext({
    query: 'A requires B',
    snapshot: { layers, graph },
    maxItems: 0,
  });
  const noGraphItems = retrieveHierarchicalMemoryContext({
    query: 'A requires B',
    snapshot: { layers, graph },
    maxItems: 8,
    budgets: { graphItems: 0 },
  });

  assert.deepEqual(noItems.items, []);
  assert.equal(noGraphItems.items.some((item) => item.source === 'memory_graph'), false);
});

test('hierarchical memory retriever emits task-startup policy signals with budget efficiency', () => {
  const layers = createGlobalMemoryLayers();
  upsertPassage(layers, { passageId: 'p1', text: 'Task startup should retrieve active memory facts.' });
  upsertSchema(layers, { headType: 'phase', relation: 'uses', tailType: 'policy_signal', frequency: 2 });
  upsertFact(layers, {
    subject: 'task_startup',
    subjectType: 'phase',
    relation: 'uses',
    object: 'active memory retrieval',
    objectType: 'policy_signal',
    passageIds: ['p1'],
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });

  const context = retrieveHierarchicalMemoryContext({
    query: 'task startup active memory retrieval',
    layers,
    graph: { stats: { activeFactCount: 1, bridgeCount: 0 } },
    maxItems: 4,
    retrievalPhase: 'task_startup',
    budgets: { graphItems: 0, tokenBudget: 400 },
  });

  assert.equal(context.policySignals.phase, 'task_startup');
  assert.equal(context.policySignals.requireEvidenceBackedFacts, true);
  assert.equal(context.policySignals.retrievalHitRate, 1);
  assert.equal(context.policySignals.budgetEfficiency > 0, true);
  assert.deepEqual(context.policySignals.startupPriorities, [
    'active_fact',
    'stable_schema',
    'passage',
  ]);
});

test('memory graph BES lane packets are sorted deduped and evidence-only', () => {
  const packet = createLaneMemoryGraphContextPacket({
    lane: 'memory',
    local: {
      nodeIds: ['local_b', 'local_a', 'local_a'],
      items: [{ id: 'too-bulky' }],
      authority: 'write',
      summary: 'local extraction context',
    },
    swarmCell: { nodeIds: ['cell_b', 'cell_a'] },
    global: {
      nodeIds: ['global_b', 'global_a'],
      provenance: [{ id: 'trace-2' }, 'trace-1'],
      authority: 'promote',
    },
    provenance: ['trace-1', { id: 'trace-3' }],
    conflicts: [{ id: 'conflict-1', status: 'needs_review', authority: 'discard' }],
    retrieval: { trace: ['fact-2', 'fact-1'] },
  });

  assert.deepEqual(packet.besLane, {
    lane: 'memory',
    authority: 'evidence_only',
    promotionAllowed: false,
  });
  assert.deepEqual(packet.local, {
    nodeIds: ['local_a', 'local_b'],
    summary: 'local extraction context',
  });
  assert.deepEqual(packet.global.nodeIds, ['global_a', 'global_b']);
  assert.equal(packet.global.authority, undefined);
  assert.deepEqual(packet.provenance, ['trace-1', 'trace-2', 'trace-3']);
  assert.deepEqual(packet.retrievalTrace, ['fact-1', 'fact-2']);
  assert.deepEqual(packet.conflicts, [{ id: 'conflict-1', status: 'needs_review' }]);
});
