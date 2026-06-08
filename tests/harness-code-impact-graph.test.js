import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractCallGraphFromIndex } from '../src/harness-sidecar/graph/callGraphHeuristics.js';
import { analyzeCodeImpact } from '../src/harness-sidecar/graph/impactAnalyzer.js';
import { extractImportGraphFromIndex } from '../src/harness-sidecar/graph/importGraph.js';
import { composeGraphRagContext } from '../src/harness-sidecar/rag/graphRagComposer.js';

const fixtureIndex = {
  items: [
    {
      path: 'src/math/add.js',
      snippet: `
        export function add(left, right) {
          return left + right;
        }
        export const identity = (value) => value;
      `,
    },
    {
      path: 'src/math/run.js',
      snippet: `
        import { add } from './add.js';
        import missingThing from './missing.js';

        export function runTotal(items) {
          return add(items.length, 1);
        }
      `,
    },
    {
      path: 'src/app.js',
      snippet: `
        import { runTotal } from './math/run.js';

        export function main(input) {
          return render(runTotal(input));
        }

        function render(value) {
          return String(value);
        }
      `,
    },
  ],
};

test('import graph extracts exports, dependencies, and unresolved relative imports', () => {
  const importGraph = extractImportGraphFromIndex(fixtureIndex, { taskId: 'task_imports' });

  assert.deepEqual(importGraph.files.map((file) => file.path), [
    'src/app.js',
    'src/math/add.js',
    'src/math/run.js',
  ]);
  assert.deepEqual(importGraph.exportsByFile.get('src/math/add.js').map((item) => item.name), [
    'add',
    'identity',
  ]);
  assert.deepEqual(importGraph.importsByFile.get('src/math/run.js').map((item) => item.source), [
    './add.js',
    './missing.js',
  ]);
  assert.equal(
    importGraph.dependencyEdges.some((edge) => (
      edge.from === 'src/app.js'
      && edge.to === 'src/math/run.js'
      && edge.type === 'imports'
      && edge.heuristic === true
    )),
    true,
  );
  assert.deepEqual(importGraph.unresolvedImports.map((item) => item.source), ['./missing.js']);
});

test('call graph heuristics extract function declarations and simple call edges', () => {
  const callGraph = extractCallGraphFromIndex(fixtureIndex, { taskId: 'task_calls' });

  assert.deepEqual(callGraph.functions.map((item) => `${item.filePath}:${item.name}`), [
    'src/app.js:main',
    'src/app.js:render',
    'src/math/add.js:add',
    'src/math/run.js:runTotal',
  ]);
  assert.equal(
    callGraph.callEdges.some((edge) => (
      edge.fromSymbol === 'src/app.js:main'
      && edge.toSymbol === 'src/math/run.js:runTotal'
      && edge.callName === 'runTotal'
      && edge.heuristic === true
    )),
    true,
  );
  assert.equal(
    callGraph.callEdges.some((edge) => (
      edge.fromSymbol === 'src/app.js:main'
      && edge.toSymbol === 'src/app.js:render'
      && edge.callName === 'render'
    )),
    true,
  );
});

test('impact analyzer returns impacted files, symbols, verifier hints, and GraphRAG items', () => {
  const importGraph = extractImportGraphFromIndex(fixtureIndex, { taskId: 'task_impact' });
  const callGraph = extractCallGraphFromIndex(fixtureIndex, { taskId: 'task_impact' });
  const impact = analyzeCodeImpact({
    changedFiles: ['src/math/add.js'],
    importGraph,
    callGraph,
    taskId: 'task_impact',
  });

  assert.deepEqual(impact.impactedFiles.map((item) => item.path), [
    'src/math/add.js',
    'src/math/run.js',
    'src/app.js',
  ]);
  assert.equal(
    impact.impactedFiles.some((item) => (
      item.path === 'src/math/run.js'
      && item.reason === 'import_graph_impacted_by_change'
    )),
    true,
  );
  assert.equal(
    impact.impactedSymbols.some((item) => (
      item.filePath === 'src/math/run.js'
      && item.name === 'runTotal'
      && item.reason === 'call_graph_references_changed_symbol'
    )),
    true,
  );
  assert.deepEqual(impact.verifierHints.map((hint) => hint.name), ['unit', 'focused_impacted_tests']);

  const context = composeGraphRagContext({
    impactAnalysis: impact,
    maxItems: 4,
  });

  assert.equal(context.items[0].source, 'code_impact_graph');
  assert.equal(context.items[1].reason, 'import_graph_impacted_by_change');
  assert.equal(context.items.some((item) => item.id === 'impact:file:src/app.js'), true);
});
