import { retrieveMemoryAwareGraphContext } from './memoryAwareGraphRetriever.js';

export const HIERARCHICAL_MEMORY_RETRIEVER_SCHEMA_VERSION = 1;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(normalizeList(values).map(String))].sort();
}

function queryTerms(query) {
  return [...new Set(String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 1))].sort();
}

function overlapScore(text, terms, boost = 0) {
  if (terms.length === 0) return boost;
  const haystack = String(text || '').toLowerCase();
  const matches = terms.filter((term) => haystack.includes(term)).length;
  if (matches === 0) return 0;
  return Math.min(1, (matches / terms.length) + boost);
}

function factText(fact = {}) {
  return [fact.subject, fact.relation || fact.predicate, fact.object].filter(Boolean).join(' ');
}

function schemaText(schema = {}) {
  return [schema.headType, schema.relation || schema.predicate, schema.tailType].filter(Boolean).join(' ');
}

function factId(fact = {}) {
  return [
    'active_fact',
    fact.subject,
    fact.relation || fact.predicate,
    fact.object,
    uniqueSorted(fact.passageIds || fact.passageId).join('_'),
  ].filter(Boolean).join(':');
}

function itemSort(left, right) {
  const priority = {
    active_fact: 0,
    stable_schema: 1,
    passage: 2,
    graph_summary: 3,
    bridge: 4,
    graph_fact: 5,
    graph_schema: 6,
    graph_passage: 7,
    pending_fact: 8,
  };
  return (
    (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9)
    || right.score - left.score
    || left.id.localeCompare(right.id)
  );
}

function factItem(fact, terms) {
  const kind = fact.status === 'active' ? 'active_fact' : 'pending_fact';
  return {
    id: fact.id || factId(fact),
    kind,
    score: overlapScore(factText(fact), terms, kind === 'active_fact' ? 0.25 : 0),
    text: factText(fact),
    provenance: uniqueSorted(fact.passageIds || fact.passageId),
    status: fact.status || 'pending',
    subject: fact.subject,
    relation: fact.relation || fact.predicate,
    object: fact.object,
  };
}

function schemaItem(schema, terms) {
  return {
    id: schema.id || `stable_schema:${schemaText(schema)}`,
    kind: 'stable_schema',
    score: overlapScore(schemaText(schema), terms, schema.status === 'stable' ? 0.1 : 0),
    text: schemaText(schema),
    provenance: [],
    status: schema.status || 'candidate',
  };
}

function passageItem(passage, terms) {
  return {
    id: passage.passageId || passage.id,
    kind: 'passage',
    score: overlapScore(passage.text || passage.summary || '', terms, 0.05),
    text: passage.text || passage.summary || '',
    provenance: uniqueSorted(passage.passageId || passage.id),
    source: passage.source,
    path: passage.path,
  };
}

function graphSummaryItem(graph = {}, terms) {
  const stats = graph.stats || {};
  const text = [
    'graph summary',
    `schemas ${stats.schemaCount ?? stats.stableSchemaCount ?? 0}`,
    `facts ${stats.factCount ?? stats.activeFactCount ?? 0}`,
    `passages ${stats.passageCount ?? 0}`,
  ].join(' ');
  return {
    id: 'graph_summary',
    kind: 'graph_summary',
    score: Math.max(0.01, overlapScore(text, terms, 0.05)),
    text,
    provenance: [],
    stats,
  };
}

function graphContextKind(item = {}) {
  if (item.kind === 'entity' || item.reasons?.includes('bridge_only')) return 'bridge';
  if (item.kind === 'fact') return 'graph_fact';
  if (item.kind === 'schema') return 'graph_schema';
  if (item.kind === 'passage') return 'graph_passage';
  return `graph_${item.kind || item.type || 'item'}`;
}

function graphContextText(item = {}) {
  return item.summary || item.label || item.text || item.sourceLabel || item.id || '';
}

function graphContextItem(item = {}) {
  return {
    id: item.sourceLabel || item.id,
    kind: graphContextKind(item),
    score: Number(item.score) || 0,
    text: graphContextText(item),
    provenance: uniqueSorted(item.provenance),
    source: item.source,
    sourceLabel: item.sourceLabel,
    reasons: normalizeList(item.reasons),
    status: item.status,
  };
}

function resolveLayersAndGraph({ layers, graph, snapshot }) {
  return {
    layers: layers || snapshot?.layers || snapshot?.globalLayers || {},
    graph: graph || snapshot?.graph || snapshot?.memoryGraph || {},
  };
}

export function retrieveHierarchicalMemoryContext({
  query,
  layers,
  graph,
  snapshot,
  maxItems = 8,
  budgets = {},
} = {}) {
  const terms = queryTerms(query);
  const limit = Math.max(0, Math.floor(Number(maxItems) || 8));
  const resolved = resolveLayersAndGraph({ layers, graph, snapshot });
  const schemas = normalizeList(resolved.layers.schemas);
  const facts = normalizeList(resolved.layers.facts);
  const passages = normalizeList(resolved.layers.passages);
  const graphItemLimit = Math.max(0, Math.floor(Number(budgets.graphItems ?? budgets.maxGraphItems ?? 4) || 4));
  const graphItems = retrieveMemoryAwareGraphContext({
    graph: resolved.graph,
    query,
    maxItems: Math.max(graphItemLimit, limit, 8),
    restartProbability: budgets.restartProbability,
    iterations: budgets.iterations,
    maxBridgeItems: budgets.maxBridgeItems,
  })
    .map(graphContextItem)
    .sort(itemSort)
    .slice(0, graphItemLimit);
  const items = [
    ...facts.map((fact) => factItem(fact, terms)),
    ...schemas.filter((schema) => schema.status === 'stable').map((schema) => schemaItem(schema, terms)),
    ...passages.map((passage) => passageItem(passage, terms)),
    graphSummaryItem(resolved.graph, terms),
    ...graphItems,
  ]
    .filter((item) => item.score > 0)
    .sort(itemSort)
    .slice(0, limit);

  const activeFactCount = facts.filter((fact) => fact.status === 'active').length;
  return {
    schemaVersion: HIERARCHICAL_MEMORY_RETRIEVER_SCHEMA_VERSION,
    source: 'hierarchical_memory',
    query,
    items,
    summary: {
      schemaCount: schemas.length,
      stableSchemaCount: schemas.filter((schema) => schema.status === 'stable').length,
      factCount: facts.length,
      activeFactCount: resolved.graph.stats?.activeFactCount ?? activeFactCount,
      passageCount: passages.length,
      bridgeCount: resolved.graph.stats?.bridgeCount ?? 0,
      graphStats: resolved.graph.stats || {},
    },
  };
}
