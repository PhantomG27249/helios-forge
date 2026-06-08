import { buildContextPack } from './contextPackBuilder.js';

const SOURCE_ORDER = ['workspace_rag', 'promoted_memory', 'graph_memory', 'memory_graph', 'knowledge_graph'];

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function normalizeReasons(value) {
  return normalizeList(value).map((reason) => String(reason));
}

function estimateTokensFromText(parts) {
  const text = normalizeList(parts).join(' ');
  return Math.max(1, Math.ceil(text.length / 4));
}

function scoreFor(item) {
  if (typeof item.score === 'number') return item.score;
  if (typeof item.ranking?.score === 'number') return item.ranking.score;
  if (Array.isArray(item.reasons)) return item.reasons.length;
  if (Array.isArray(item.reason)) return item.reason.length;
  return item.reason ? 1 : 0;
}

function sourceRank(source) {
  const rank = SOURCE_ORDER.indexOf(source);
  return rank === -1 ? SOURCE_ORDER.length : rank;
}

function sourceLabelFor(source, item) {
  if (item.sourceLabel) return item.sourceLabel;
  if (source === 'workspace_rag') return `workspace:${item.path || item.chunkId || item.id || 'unknown'}`;
  if (source === 'promoted_memory') return `memory:${item.memoryId || item.id || 'unknown'}`;
  if (source === 'graph_memory') return `graph-memory:${item.memoryId || item.id || 'unknown'}`;
  if (source === 'memory_graph') return item.sourceLabel || `memgraph:${item.id || item.label || 'unknown'}`;
  if (source === 'knowledge_graph') return `graph:${item.id || item.label || 'unknown'}`;
  return `${source}:${item.id || item.memoryId || item.path || item.type || 'unknown'}`;
}

function normalizeWorkspaceItem(item) {
  return {
    ...item,
    source: 'workspace_rag',
    sourceLabel: sourceLabelFor('workspace_rag', item),
    reasons: normalizeReasons(item.reasons || item.reason),
    provenance: normalizeList(item.provenance),
    tokensEstimated: item.tokensEstimated || estimateTokensFromText([item.path, item.snippet, item.content]),
  };
}

function normalizeMemoryItem(item) {
  return {
    ...item,
    id: item.id || item.memoryId,
    source: 'promoted_memory',
    sourceLabel: sourceLabelFor('promoted_memory', item),
    reasons: normalizeReasons(item.reasons || item.reason),
    provenance: normalizeList(item.provenance),
    tokensEstimated: item.tokensEstimated || item.tokenEstimate || estimateTokensFromText([
      item.type,
      item.summary,
      item.pattern,
      ...normalizeList(item.evidence),
    ]),
  };
}

function normalizeGraphMemoryItem(item) {
  return {
    ...item,
    id: item.id || item.memoryId,
    source: 'graph_memory',
    sourceLabel: sourceLabelFor('graph_memory', item),
    reasons: normalizeReasons(item.reasons || item.reason),
    provenance: normalizeList(item.provenance),
    tokensEstimated: item.tokensEstimated || item.tokenEstimate || estimateTokensFromText([
      item.type,
      item.summary,
      ...normalizeList(item.evidence),
    ]),
  };
}

function normalizeKnowledgeGraphItem(item) {
  return {
    ...item,
    source: 'knowledge_graph',
    sourceLabel: sourceLabelFor('knowledge_graph', item),
    reasons: normalizeReasons(item.reasons || item.reason),
    provenance: normalizeList(item.provenance),
    tokensEstimated: item.tokensEstimated || estimateTokensFromText([
      item.type,
      item.label,
      item.path,
      item.value,
      item.reason,
    ]),
  };
}

function normalizeMemoryAwareGraphItem(item) {
  return {
    ...item,
    source: 'memory_graph',
    sourceLabel: sourceLabelFor('memory_graph', item),
    reasons: normalizeReasons(item.reasons || item.reason),
    provenance: normalizeList(item.provenance),
    tokensEstimated: item.tokensEstimated || estimateTokensFromText([
      item.type,
      item.label,
      item.summary,
      item.path,
      item.value,
      item.reason,
    ]),
  };
}

function dedupeUnifiedItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}\0${item.chunkId || item.memoryId || item.id || item.sourceLabel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderWithinSource(items) {
  return items.slice().sort((left, right) => (
    scoreFor(right) - scoreFor(left)
    || String(left.sourceLabel).localeCompare(String(right.sourceLabel))
    || String(left.path || '').localeCompare(String(right.path || ''))
    || (left.lineStart || 0) - (right.lineStart || 0)
  ));
}

function diversifyBySource(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.source)) grouped.set(item.source, []);
    grouped.get(item.source).push(item);
  }

  const sources = [...grouped.keys()].sort((left, right) => sourceRank(left) - sourceRank(right));
  for (const source of sources) {
    grouped.set(source, orderWithinSource(grouped.get(source)));
  }

  const diversified = [];
  let round = 0;
  while (diversified.length < items.length) {
    let added = false;
    for (const source of sources) {
      const candidate = grouped.get(source)[round];
      if (!candidate) continue;
      diversified.push(candidate);
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  return diversified;
}

export function composeUnifiedContext({
  taskId,
  profile = 'coding_small',
  workspaceItems = [],
  memoryItems = [],
  graphMemoryItems = [],
  memoryGraphItems = [],
  graphItems = [],
  maxTokens = 6000,
  sourceDiversity = true,
} = {}) {
  const normalized = dedupeUnifiedItems([
    ...normalizeList(workspaceItems).map(normalizeWorkspaceItem),
    ...normalizeList(memoryItems).map(normalizeMemoryItem),
    ...normalizeList(graphMemoryItems).map(normalizeGraphMemoryItem),
    ...normalizeList(memoryGraphItems).map(normalizeMemoryAwareGraphItem),
    ...normalizeList(graphItems).map(normalizeKnowledgeGraphItem),
  ]);
  const orderedItems = sourceDiversity ? diversifyBySource(normalized) : orderWithinSource(normalized);
  const contextPack = buildContextPack({
    taskId,
    profile,
    items: orderedItems,
    maxTokens,
    sourceDiversity: false,
  });

  return {
    ...contextPack,
    sourceLabels: contextPack.items.map((item) => item.sourceLabel),
    sources: [...new Set(contextPack.items.map((item) => item.source))],
  };
}
