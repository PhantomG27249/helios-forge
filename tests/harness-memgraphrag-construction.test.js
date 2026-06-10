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
  adjudicateMemoryConflict,
  applyConflictDecision,
  detectGlobalMemoryConflicts,
} from '../src/harness-sidecar/memory/memoryConflictAdjudicator.js';
import { constructMemoryGuidedGraph } from '../src/harness-sidecar/memory/memoryGraphConstructor.js';
import { createGraphMemoryStore } from '../src/harness-sidecar/memory/graphMemoryStore.js';
import { maintainGraphMemorySnapshot } from '../src/harness-sidecar/memory/graphMemoryMaintenance.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-memgraphrag-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function activeLayerFixture() {
  const layers = createGlobalMemoryLayers();
  upsertPassage(layers, {
    passageId: 'passage_policy',
    text: 'The memory policy module tunes schema thresholds.',
    path: 'src/harness-sidecar/meta/memoryPolicyEvolution.js',
    span: { start: 1, end: 20 },
    source: 'workspace',
  });
  upsertSchema(layers, {
    headType: 'module',
    relation: 'tunes',
    tailType: 'policy_knob',
  });
  upsertSchema(layers, {
    headType: 'module',
    relation: 'tunes',
    tailType: 'policy_knob',
  });
  const fact = upsertFact(layers, {
    subject: 'memoryPolicyEvolution',
    subjectType: 'module',
    relation: 'tunes',
    object: 'schemaThreshold',
    objectType: 'policy_knob',
    passageIds: ['passage_policy'],
    confidence: 0.88,
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });
  return { layers, fact };
}

test('global memory layers keep schemas facts and passages separated with pending fact promotion', () => {
  const layers = createGlobalMemoryLayers();
  const passage = upsertPassage(layers, {
    passageId: 'passage_001',
    text: 'Graph memory maintenance writes snapshots.',
    path: 'src/harness-sidecar/memory/graphMemoryMaintenance.js',
    span: { start: 10, end: 18 },
    source: 'workspace_index',
    artifactId: 'artifact_snapshot',
  });
  const firstSchema = upsertSchema(layers, {
    headType: 'module',
    relation: 'writes',
    tailType: 'artifact',
  });
  const fact = upsertFact(layers, {
    subject: 'graphMemoryMaintenance',
    subjectType: 'module',
    relation: 'writes',
    object: 'graph-snapshot.json',
    objectType: 'artifact',
    passageIds: [passage.passageId],
  });

  assert.equal(layers.schemas.length, 1);
  assert.equal(layers.facts.length, 1);
  assert.equal(layers.passages.length, 1);
  assert.equal(layers.schemas[0].id, firstSchema.id);
  assert.equal(fact.status, 'pending');
  assert.deepEqual(fact.passageIds, ['passage_001']);
  assert.deepEqual(layers.passages[0].span, { start: 10, end: 18 });

  const secondSchema = upsertSchema(layers, {
    headType: 'module',
    relation: 'writes',
    tailType: 'artifact',
  });
  assert.equal(secondSchema.id, firstSchema.id);
  assert.equal(secondSchema.frequency, 2);

  const activated = activateStableSchemas({ layers, schemaThreshold: 2 });

  assert.deepEqual(activated.stableSchemaIds, [firstSchema.id]);
  assert.deepEqual(activated.activatedFactIds, [fact.id]);
  assert.equal(layers.schemas[0].status, 'stable');
  assert.equal(layers.facts[0].status, 'active');
});

test('facts governed by unstable schemas stay pending', () => {
  const layers = createGlobalMemoryLayers();
  upsertSchema(layers, {
    headType: 'module',
    relation: 'mentions',
    tailType: 'concept',
  });
  const fact = upsertFact(layers, {
    subject: 'graphRagComposer',
    subjectType: 'module',
    relation: 'mentions',
    object: 'memory-aware retrieval',
    objectType: 'concept',
    passageIds: ['passage_missing'],
  });

  activateStableSchemas({ layers, schemaThreshold: 2 });

  assert.equal(layers.schemas[0].status, 'candidate');
  assert.equal(layers.facts.find((item) => item.id === fact.id).status, 'pending');
});

test('conflict adjudication classifies and applies evidence-backed decisions safely', () => {
  const layers = createGlobalMemoryLayers();
  upsertSchema(layers, { headType: 'service', relation: 'uses', tailType: 'backend' });
  upsertSchema(layers, { headType: 'service', relation: 'uses', tailType: 'backend' });
  const active = upsertFact(layers, {
    subject: 'retriever',
    subjectType: 'service',
    relation: 'uses',
    object: 'lexical search',
    objectType: 'backend',
    passageIds: ['passage_old'],
    confidence: 0.6,
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });

  const [mutual] = detectGlobalMemoryConflicts({
    layers,
    newFact: {
      subject: 'retriever',
      subjectType: 'service',
      relation: 'uses',
      object: 'graph search',
      objectType: 'backend',
      passageIds: ['passage_new'],
      confidence: 0.95,
    },
  });
  assert.equal(mutual.type, 'mutually_exclusive');

  const decision = adjudicateMemoryConflict({
    conflict: mutual,
    evidence: ['passage_old', 'passage_new'],
    policy: { autoDiscardBelowConfidence: 0.7 },
  });
  assert.equal(decision.action, 'discard');
  assert.deepEqual(decision.provenanceIds, ['passage_old', 'passage_new']);
  assert.equal(decision.decisionId.startsWith('memory_conflict_decision_'), true);
  assert.deepEqual(decision.policy, {
    autoDiscardBelowConfidence: 0.7,
    requirePassageSupport: false,
  });
  assert.equal(decision.evidenceSummary.requiredCount, 2);
  assert.equal(decision.evidenceSummary.coveredCount, 2);

  applyConflictDecision({ layers, decision });

  assert.equal(layers.facts.find((fact) => fact.id === active.id).status, 'discarded');

  const temporal = detectGlobalMemoryConflicts({
    layers,
    newFact: {
      subject: 'retriever',
      relation: 'uses',
      object: 'hybrid search',
      validFrom: '2026-06-08',
      passageIds: ['passage_temporal'],
    },
  }).find((conflict) => conflict.type === 'temporal');
  assert.equal(adjudicateMemoryConflict({ conflict: temporal, evidence: ['passage_temporal'] }).action, 'temporally_qualify');

  const granularity = detectGlobalMemoryConflicts({
    layers,
    newFact: {
      subject: 'retriever',
      relation: 'uses',
      object: 'lexical search',
      granularity: 'implementation-detail',
      passageIds: ['passage_granular'],
    },
  }).find((conflict) => conflict.type === 'granularity');
  assert.equal(adjudicateMemoryConflict({ conflict: granularity, evidence: ['passage_granular'] }).action, 'refine');

  const stale = adjudicateMemoryConflict({
    conflict: { type: 'stale_or_superseded', existingFact: active, newFact: { passageIds: ['passage_newer'] } },
    evidence: ['passage_newer'],
  });
  assert.equal(stale.action, 'discard');

  const uncertain = adjudicateMemoryConflict({
    conflict: { type: 'source_confidence', existingFact: active, newFact: { passageIds: ['passage_low'], confidence: 0.51 } },
  });
  assert.equal(uncertain.action, 'needs_review');

  const safeCoexistence = adjudicateMemoryConflict({
    conflict: { type: 'source_confidence', existingFact: active, newFact: { passageIds: ['passage_high'], confidence: 0.96 } },
    evidence: ['passage_high'],
  });
  assert.equal(safeCoexistence.action, 'keep_both');
});

test('conflict adjudication uses retrieved passage text to ground mutually exclusive decisions', () => {
  const conflict = {
    type: 'mutually_exclusive',
    existingFact: {
      id: 'fact_old',
      subject: 'retriever',
      relation: 'uses',
      object: 'lexical search',
      passageIds: ['passage_old'],
      confidence: 0.8,
    },
    newFact: {
      id: 'fact_new',
      subject: 'retriever',
      relation: 'uses',
      object: 'graph search',
      passageIds: ['passage_new'],
      confidence: 0.8,
    },
    provenanceIds: ['passage_old', 'passage_new'],
  };

  const grounded = adjudicateMemoryConflict({
    conflict,
    evidence: [
      { passageId: 'passage_new', text: 'The current retriever uses graph search for startup context.' },
      { passageId: 'passage_old', text: 'Earlier versions used lexical search.' },
    ],
    policy: { requirePassageSupport: true },
  });
  const ungrounded = adjudicateMemoryConflict({
    conflict,
    evidence: [{ passageId: 'passage_old', text: 'Earlier versions used lexical search.' }],
    policy: { requirePassageSupport: true },
  });

  assert.equal(grounded.action, 'discard');
  assert.equal(grounded.targetFactId, 'fact_old');
  assert.equal(grounded.evidenceCoverage, 1);
  assert.equal(grounded.reasons.includes('retrieved_passage_supports_new_fact'), true);
  assert.equal(ungrounded.action, 'needs_review');
  assert.equal(ungrounded.reasons.includes('missing_required_passage_support'), true);
});

test('memory-guided graph projects active global memory and bridges compatible entities', () => {
  const { layers } = activeLayerFixture();
  upsertSchema(layers, {
    headType: 'module',
    relation: 'reads',
    tailType: 'policy_knob',
  });
  upsertSchema(layers, {
    headType: 'module',
    relation: 'reads',
    tailType: 'policy_knob',
  });
  upsertFact(layers, {
    subject: 'graphRagComposer',
    subjectType: 'module',
    relation: 'reads',
    object: 'schemaThreshold',
    objectType: 'policy_knob',
    passageIds: ['passage_policy'],
    confidence: 0.84,
  });
  upsertFact(layers, {
    subject: 'pendingOnly',
    subjectType: 'module',
    relation: 'mentions',
    object: 'unstableKnob',
    objectType: 'concept',
    passageIds: ['passage_policy'],
  });
  activateStableSchemas({ layers, schemaThreshold: 2 });

  const graph = constructMemoryGuidedGraph({
    layers,
    bridgingThreshold: 0.8,
    similarity: (left, right) => (
      [left.label, right.label].includes('memoryPolicyEvolution')
        && [left.label, right.label].includes('graphRagComposer')
        ? 0.91
        : 0
    ),
  });

  assert.equal(graph.stats.schemaCount, 2);
  assert.equal(graph.stats.activeFactCount, 2);
  assert.equal(graph.stats.pendingFactCount, 1);
  assert.equal(graph.stats.passageCount, 1);
  assert.equal(graph.nodes.some((node) => node.kind === 'fact' && node.status === 'pending'), false);
  assert.equal(graph.nodes.some((node) => node.kind === 'passage' && node.path.endsWith('memoryPolicyEvolution.js')), true);
  assert.equal(graph.edges.some((edge) => edge.type === 'evidenced_by' && edge.provenance.includes('passage_policy')), true);
  assert.equal(graph.edges.some((edge) => edge.type === 'memgraph_bridge' && edge.reason === 'compatible_schema_type'), true);
  assert.equal(graph.edges.some((edge) => edge.type === 'memgraph_bridge' && edge.reason === 'similarity_above_threshold'), true);
  assert.equal(graph.stats.bridgeCount >= 2, true);
});

test('graph memory maintenance can persist global memory and memory-guided graph sections', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const { layers } = activeLayerFixture();
    const memoryGuidedGraph = constructMemoryGuidedGraph({ layers });

    await maintainGraphMemorySnapshot({
      workspaceRoot,
      promotedMemories: [],
      globalMemory: layers,
      memoryGuidedGraph,
    });

    const snapshot = await createGraphMemoryStore({ workspaceRoot }).load();

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.globalMemory.schemas.length, 1);
    assert.equal(snapshot.memoryGuidedGraph.stats.activeFactCount, 1);
    assert.deepEqual(snapshot.nodes, []);
  });
});
