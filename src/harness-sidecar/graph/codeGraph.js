import { GraphStore } from './graphStore.js';
import { createProvenance } from './provenance.js';

const SYMBOL_PATTERN = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\bclass\s+([A-Za-z_$][\w$]*)/g;

export function createCodeGraphFromIndex(index, { taskId = 'index' } = {}) {
  const graph = new GraphStore();

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

  return graph;
}
