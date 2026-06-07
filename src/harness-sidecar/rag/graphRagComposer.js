import { queryGraph } from '../graph/graphQuery.js';

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

export function composeGraphRagContext({ graph, queries = [], maxItems = 8 } = {}) {
  const items = dedupeById(queries.flatMap((query) => queryGraph(graph, query)))
    .slice(0, maxItems)
    .map((item) => ({
      id: item.id,
      source: 'knowledge_graph',
      type: item.type,
      label: item.label,
      path: item.path,
      value: item.value,
      reason: item.reason,
      provenance: item.provenance || [],
    }));

  return {
    source: 'knowledge_graph',
    items,
  };
}
