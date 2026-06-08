import { queryGraph } from '../graph/graphQuery.js';
import { retrieveMemoryAwareGraphContext } from './memoryAwareGraphRetriever.js';

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

function impactItemFromFile(item) {
  return {
    id: `impact:file:${item.path}`,
    source: 'code_impact_graph',
    type: 'file',
    label: item.path,
    path: item.path,
    value: {
      distance: item.distance,
      via: item.via,
    },
    reason: item.reason,
    provenance: [],
  };
}

function impactItemFromSymbol(item) {
  return {
    id: `impact:symbol:${item.symbolId}`,
    source: 'code_impact_graph',
    type: 'symbol',
    label: item.name,
    path: item.filePath,
    value: {
      via: item.via,
      heuristic: item.heuristic,
    },
    reason: item.reason,
    provenance: [],
  };
}

function impactItemsFromAnalysis(impactAnalysis) {
  if (!impactAnalysis) {
    return [];
  }
  return [
    ...(impactAnalysis.impactedFiles || []).map(impactItemFromFile),
    ...(impactAnalysis.impactedSymbols || []).map(impactItemFromSymbol),
  ];
}

export function composeGraphRagContext({
  graph,
  queries = [],
  impactAnalysis,
  memoryAwareQuery,
  memoryAwareOptions = {},
  maxItems = 8,
} = {}) {
  const graphItems = graph ? queries.flatMap((query) => queryGraph(graph, query)) : [];
  const memoryAwareItems = graph && memoryAwareQuery
    ? retrieveMemoryAwareGraphContext({
      graph,
      query: memoryAwareQuery,
      maxItems,
      ...memoryAwareOptions,
    })
    : [];
  const items = dedupeById([...memoryAwareItems, ...graphItems, ...impactItemsFromAnalysis(impactAnalysis)])
    .slice(0, maxItems)
    .map((item) => ({
      id: item.id,
      source: item.source || 'knowledge_graph',
      type: item.type,
      label: item.label,
      path: item.path,
      value: item.value,
      reason: item.reason,
      reasons: item.reasons,
      score: item.score,
      sourceLabel: item.sourceLabel,
      status: item.status,
      provenance: item.provenance || [],
      tokensEstimated: item.tokensEstimated,
    }));

  return {
    source: memoryAwareItems.length > 0
      ? 'memory_aware_knowledge_graph'
      : (impactAnalysis ? 'knowledge_graph_with_code_impact' : 'knowledge_graph'),
    items,
  };
}

export function composeGraphRagContextWithImpact({
  graph,
  queries = [],
  impactAnalysis,
  maxItems = 8,
} = {}) {
  return composeGraphRagContext({ graph, queries, impactAnalysis, maxItems });
}
