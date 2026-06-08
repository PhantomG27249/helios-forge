import { GraphStore } from './graphStore.js';
import { extractCallGraphFromIndex } from './callGraphHeuristics.js';
import { extractImportGraphFromIndex } from './importGraph.js';
import { createProvenance } from './provenance.js';

const SYMBOL_PATTERN = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\bclass\s+([A-Za-z_$][\w$]*)/g;

export function createCodeGraphFromIndex(index, { taskId = 'index' } = {}) {
  const graph = new GraphStore();
  const importGraph = extractImportGraphFromIndex(index, { taskId });
  const callGraph = extractCallGraphFromIndex(index, { taskId });

  for (const item of index.items || []) {
    const fileId = `file:${item.path}`;
    const provenance = [createProvenance({
      taskId,
      path: item.path,
      reason: 'indexed code file',
      sourceType: 'code_index',
    })];

    graph.upsertNode({
      id: fileId,
      type: 'file',
      label: item.path,
      provenance,
    });

    for (const match of item.snippet.matchAll(SYMBOL_PATTERN)) {
      const symbolName = match[1] || match[2];
      const symbolId = `symbol:${item.path}:${symbolName}`;
      graph.upsertNode({
        id: symbolId,
        type: 'symbol',
        label: symbolName,
        provenance,
      });
      graph.upsertEdge({
        from: fileId,
        to: symbolId,
        type: 'defines',
        provenance,
      });
    }
  }

  for (const edge of importGraph.dependencyEdges) {
    const provenance = [createProvenance({
      taskId,
      path: edge.from,
      reason: 'import graph dependency',
      sourceType: 'code_import_graph',
    })];
    graph.upsertNode({
      id: `file:${edge.from}`,
      type: 'file',
      label: edge.from,
      provenance,
    });
    graph.upsertNode({
      id: `file:${edge.to}`,
      type: 'file',
      label: edge.to,
      provenance,
    });
    graph.upsertEdge({
      from: `file:${edge.from}`,
      to: `file:${edge.to}`,
      type: 'imports',
      source: edge.source,
      heuristic: true,
      provenance,
    });
  }

  for (const edge of callGraph.callEdges) {
    const provenance = [createProvenance({
      taskId,
      path: edge.fromFile,
      reason: 'heuristic call reference',
      sourceType: 'code_call_graph',
    })];
    graph.upsertEdge({
      from: `symbol:${edge.fromSymbol}`,
      to: `symbol:${edge.toSymbol}`,
      type: 'calls',
      callName: edge.callName,
      heuristic: true,
      provenance,
    });
  }

  return graph;
}
