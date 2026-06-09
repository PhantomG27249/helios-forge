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
  const priority = { active_fact: 0, stable_schema: 1, passage: 2, pending_fact: 3 };
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

export function retrieveHierarchicalMemoryContext({
  query,
  layers = {},
  graph = {},
  maxItems = 8,
} = {}) {
  const terms = queryTerms(query);
  const limit = Math.max(0, Math.floor(Number(maxItems) || 8));
  const schemas = normalizeList(layers.schemas);
  const facts = normalizeList(layers.facts);
  const passages = normalizeList(layers.passages);
  const items = [
    ...facts.map((fact) => factItem(fact, terms)),
    ...schemas.filter((schema) => schema.status === 'stable').map((schema) => schemaItem(schema, terms)),
    ...passages.map((passage) => passageItem(passage, terms)),
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
      activeFactCount: graph.stats?.activeFactCount ?? activeFactCount,
      passageCount: passages.length,
      graphStats: graph.stats || {},
    },
  };
}
