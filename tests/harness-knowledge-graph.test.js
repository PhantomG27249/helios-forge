import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildClaimEvidenceGraph } from '../src/harness-sidecar/graph/claimEvidenceGraph.js';
import { extractEntities } from '../src/harness-sidecar/graph/entityExtractor.js';
import { buildExperimentGraph } from '../src/harness-sidecar/graph/experimentGraph.js';
import { GraphStore } from '../src/harness-sidecar/graph/graphStore.js';
import { findSupportingRunsForClaim, findTestsValidatingFile } from '../src/harness-sidecar/graph/graphQuery.js';
import { buildVisualGraph } from '../src/harness-sidecar/graph/visualGraph.js';
import { composeGraphRagContext } from '../src/harness-sidecar/rag/graphRagComposer.js';

test('entity extractor finds structured and textual knowledge graph entities', () => {
  const entities = extractEntities({
    files: ['src/harness-sidecar/server.js'],
    tests: ['tests/harness-sidecar.test.js'],
    runs: [{ id: 'run_001' }],
    metrics: [{ name: 'accuracy', value: 0.92 }],
    artifacts: [{ path: 'artifacts/report.md' }],
    text: 'Claim: sidecar routing is stable. Failure: timeout in verifier. function startSidecar() {}',
  });

  assert.deepEqual(
    entities.map((entity) => [entity.type, entity.id]),
    [
      ['file', 'file:src/harness-sidecar/server.js'],
      ['test', 'test:tests/harness-sidecar.test.js'],
      ['run', 'run:run_001'],
      ['metric', 'metric:accuracy'],
      ['artifact', 'artifact:artifacts/report.md'],
      ['claim', 'claim:sidecar-routing-is-stable'],
      ['failure', 'failure:timeout-in-verifier'],
      ['symbol', 'symbol:startSidecar'],
    ],
  );
});

test('claim evidence graph links claims to evidence with provenance', () => {
  const graph = buildClaimEvidenceGraph({
    taskId: 'task_claims',
    claims: [
      {
        id: 'claim-routing-stable',
        text: 'Sidecar routing is stable',
        evidence: [
          { type: 'test', path: 'tests/harness-sidecar.test.js', summary: 'router regression passed' },
          { type: 'run', id: 'run_001', summary: 'npm test focused harness sidecar' },
        ],
      },
    ],
  });

  assert.equal(graph.getNode('claim:claim-routing-stable').label, 'Sidecar routing is stable');
  assert.equal(graph.getNode('test:tests/harness-sidecar.test.js').type, 'test');

  const evidenceEdges = graph.findEdges({ from: 'claim:claim-routing-stable', type: 'supported_by' });
  assert.equal(evidenceEdges.length, 2);
  assert.equal(evidenceEdges[0].provenance[0].taskId, 'task_claims');
  assert.equal(evidenceEdges[0].provenance[0].reason, 'claim evidence link');
});

test('experiment graph links hypotheses, configs, runs, metrics, and decisions', () => {
  const graph = buildExperimentGraph({
    taskId: 'task_experiment',
    hypothesis: { id: 'hyp_fast_rag', text: 'GraphRAG improves focused context' },
    config: { id: 'cfg_top3', params: { topK: 3 } },
    runs: [
      {
        id: 'run_kg_001',
        metrics: [{ name: 'precision', value: 0.88 }],
      },
    ],
    decision: { id: 'decision_ship_mvp', outcome: 'ship', reason: 'precision above threshold' },
  });

  assert.equal(graph.getNode('hypothesis:hyp_fast_rag').label, 'GraphRAG improves focused context');
  assert.equal(graph.getNode('metric:run_kg_001:precision').value, 0.88);
  assert.equal(graph.findEdges({ from: 'hypothesis:hyp_fast_rag', to: 'config:cfg_top3', type: 'tested_by_config' }).length, 1);
  assert.equal(graph.findEdges({ from: 'run:run_kg_001', to: 'metric:run_kg_001:precision', type: 'recorded_metric' }).length, 1);
  assert.equal(graph.findEdges({ from: 'decision:decision_ship_mvp', to: 'run:run_kg_001', type: 'based_on_run' }).length, 1);
});

test('visual graph links artifacts to source files, figures, screenshots, and observations', () => {
  const graph = buildVisualGraph({
    taskId: 'task_visual',
    artifact: { path: 'artifacts/screens/home.png', label: 'home screenshot' },
    sourceFiles: ['public/app.js'],
    figures: [{ id: 'fig_home', label: 'Home viewport' }],
    screenshots: [{ path: 'artifacts/screens/home.png' }],
    observations: [{ id: 'obs_overlap', text: 'No text overlap in controls' }],
  });

  assert.equal(graph.getNode('artifact:artifacts/screens/home.png').label, 'home screenshot');
  assert.equal(graph.findEdges({ from: 'artifact:artifacts/screens/home.png', to: 'file:public/app.js', type: 'visualizes_source' }).length, 1);
  assert.equal(graph.findEdges({ from: 'artifact:artifacts/screens/home.png', to: 'figure:fig_home', type: 'contains_figure' }).length, 1);
  assert.equal(graph.findEdges({ from: 'observation:obs_overlap', to: 'artifact:artifacts/screens/home.png', type: 'observed_on' }).length, 1);
});

test('graph query finds validating tests and supporting runs', () => {
  const graph = new GraphStore();
  buildClaimEvidenceGraph({
    graph,
    taskId: 'task_query_claim',
    claims: [
      {
        id: 'claim-routing-stable',
        text: 'Sidecar routing is stable',
        evidence: [{ type: 'run', id: 'run_001', summary: 'focused harness run' }],
      },
    ],
  });
  graph.upsertNode({ id: 'file:src/harness-sidecar/server.js', type: 'file', label: 'src/harness-sidecar/server.js' });
  graph.upsertNode({ id: 'test:tests/harness-sidecar.test.js', type: 'test', label: 'tests/harness-sidecar.test.js' });
  graph.upsertEdge({ from: 'test:tests/harness-sidecar.test.js', to: 'file:src/harness-sidecar/server.js', type: 'validates' });

  const tests = findTestsValidatingFile(graph, 'src/harness-sidecar/server.js');
  const runs = findSupportingRunsForClaim(graph, 'claim-routing-stable');

  assert.deepEqual(tests.map((item) => item.id), ['test:tests/harness-sidecar.test.js']);
  assert.deepEqual(runs.map((item) => item.id), ['run:run_001']);
  assert.equal(runs[0].reason, 'supports claim claim-routing-stable');
});

test('GraphRAG context includes query results with provenance reasons', () => {
  const graph = buildClaimEvidenceGraph({
    taskId: 'task_rag',
    claims: [
      {
        id: 'claim-routing-stable',
        text: 'Sidecar routing is stable',
        evidence: [{ type: 'run', id: 'run_001', summary: 'focused harness run' }],
      },
    ],
  });

  const context = composeGraphRagContext({
    graph,
    queries: [{ type: 'supporting_runs_for_claim', claimId: 'claim-routing-stable' }],
  });

  assert.equal(context.items.length, 1);
  assert.equal(context.items[0].id, 'run:run_001');
  assert.equal(context.items[0].source, 'knowledge_graph');
  assert.equal(context.items[0].reason, 'supports claim claim-routing-stable');
  assert.equal(context.items[0].provenance[0].taskId, 'task_rag');
});
