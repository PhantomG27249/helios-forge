import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCodeGraphFromIndex } from '../src/harness-sidecar/graph/codeGraph.js';
import { GraphStore } from '../src/harness-sidecar/graph/graphStore.js';
import { createProvenance } from '../src/harness-sidecar/graph/provenance.js';
import { planSubgoals } from '../src/harness-sidecar/bes/subgoalPlanner.js';
import { scoreSubgoals } from '../src/harness-sidecar/bes/subgoalScorer.js';
import { seedAttemptStrategies } from '../src/harness-sidecar/bes/strategySeeder.js';

test('graph store records nodes, edges, and provenance', () => {
  const graph = new GraphStore();
  const source = createProvenance({ taskId: 'task_graph', path: 'src/server.js', reason: 'unit test' });

  graph.upsertNode({ id: 'file:src/server.js', type: 'file', label: 'src/server.js', provenance: [source] });
  graph.upsertNode({ id: 'symbol:startServer', type: 'symbol', label: 'startServer', provenance: [source] });
  graph.upsertEdge({ from: 'file:src/server.js', to: 'symbol:startServer', type: 'defines', provenance: [source] });

  assert.equal(graph.getNode('file:src/server.js').label, 'src/server.js');
  assert.equal(graph.findEdges({ type: 'defines' }).length, 1);
  assert.equal(graph.findEdges({ from: 'file:src/server.js' })[0].provenance[0].taskId, 'task_graph');
});

test('code graph extracts simple function symbols from indexed files', () => {
  const codeGraph = createCodeGraphFromIndex({
    items: [
      {
        path: 'src/example.js',
        snippet: 'export function runHarnessTask() { return true; }\nclass HarnessThing {}\n',
      },
    ],
  });

  assert.equal(Boolean(codeGraph.getNode('file:src/example.js')), true);
  assert.equal(Boolean(codeGraph.getNode('symbol:src/example.js:runHarnessTask')), true);
  assert.equal(Boolean(codeGraph.getNode('symbol:src/example.js:HarnessThing')), true);
});

test('BES planner seeds checkable subgoals and strategies', () => {
  const subgoals = planSubgoals({
    taskType: 'coding_bugfix',
    task: 'fix failing verifier and propose patch',
  });
  const strategies = seedAttemptStrategies({ taskType: 'coding_bugfix', maxAttempts: 4 });

  assert.equal(subgoals.length >= 5, true);
  assert.equal(subgoals.every((subgoal) => subgoal.id && subgoal.verifier), true);
  assert.deepEqual(strategies.map((strategy) => strategy.name), [
    'reproduce_first',
    'minimal_patch',
    'test_first',
    'retrieval_first',
  ]);
});

test('BES scorer reports completed and missing subgoals', () => {
  const subgoals = [
    { id: 'S1', description: 'Reproduce failure' },
    { id: 'S2', description: 'Patch relevant source' },
    { id: 'S3', description: 'Verifier passes' },
  ];

  const score = scoreSubgoals({
    subgoals,
    completedSubgoalIds: ['S1', 'S3'],
  });

  assert.equal(score.completed, 2);
  assert.equal(score.total, 3);
  assert.equal(score.percent, 67);
  assert.deepEqual(score.missingSubgoalIds, ['S2']);
});
